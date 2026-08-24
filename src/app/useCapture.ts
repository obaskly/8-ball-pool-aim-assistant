import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  OverlayNative,
  type CaptureConfig,
  type FrameAnalysis,
} from '../../modules/overlay-native';
import type { CalibrationAdjustment } from '../calibration/tableProfile';
import {
  FrameSmoother,
  VisionLatch,
  isVisionWorld,
  worldFromAnalysis,
  type LatchedVision,
} from '../vision';

export interface CaptureStats {
  /** Frames delivered since capture started. */
  frames: number;
  /** Native analysis cost of the most recent frame, in milliseconds. */
  analysisMs: number;
  /** Measured delivery rate, averaged over the last second. */
  fps: number;
  /** Balls in the most recent frame. */
  ballCount: number;
  /** Why the most recent frame produced no world, when it produced none. */
  rejection: string | null;
  /** Fraction of the frame matching the cloth signature. */
  clothFraction: number;
  /** The cloth colour the analyser is matching, or null before it has one. */
  clothColor: string | null;
  /** Frames since the reading currently on the overlay was actually taken. */
  age: number;
  /** True while the game's own guideline is on screen. */
  aimIsLive: boolean;
}

const EMPTY_STATS: CaptureStats = {
  frames: 0,
  analysisMs: 0,
  fps: 0,
  ballCount: 0,
  rejection: null,
  clothFraction: 0,
  clothColor: null,
  age: 0,
  aimIsLive: false,
};

export interface CaptureApi {
  running: boolean;
  error: string | null;
  /** The reading currently on the overlay, fresh or held. Null when cleared. */
  vision: LatchedVision | null;
  stats: CaptureStats;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Re-read the cloth colour off the table on the next frame. */
  relearnCloth: () => void;
}

/** How often the control panel is allowed to re-render from capture data. */
const UI_UPDATE_INTERVAL_MS = 250;

/**
 * Drives the native screen-capture pipeline and turns its frames into worlds.
 *
 * `onVision` is called synchronously for every frame that has something to draw,
 * held readings included — that is the path the overlay is drawn from, and it
 * has to run at the full capture rate. React state is updated on a much slower
 * clock, because the control panel is behind the game while capture is running
 * and re-rendering it fifteen times a second would cost battery for something
 * nobody is looking at.
 */
export function useCapture(
  config: CaptureConfig,
  adjust: CalibrationAdjustment,
  onVision?: (vision: LatchedVision) => void,
  onLost?: () => void
): CaptureApi {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vision, setVision] = useState<LatchedVision | null>(null);
  const [stats, setStats] = useState<CaptureStats>(EMPTY_STATS);

  const smoother = useMemo(() => new FrameSmoother(), []);
  const latch = useMemo(() => new VisionLatch(), []);

  // Read inside the frame listener, which is created once. Without the refs it
  // would capture the first render's values and never see a calibration change.
  const adjustRef = useRef(adjust);
  adjustRef.current = adjust;

  const onVisionRef = useRef(onVision);
  onVisionRef.current = onVision;

  const onLostRef = useRef(onLost);
  onLostRef.current = onLost;

  const rateRef = useRef({ count: 0, since: 0, fps: 0 });
  const lastUiUpdateRef = useRef(0);

  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    try {
      sub = OverlayNative.addListener('onFrameAnalyzed', (frame: FrameAnalysis) => {
        const now = Date.now();
        const rate = rateRef.current;
        rate.count += 1;
        if (rate.since === 0) rate.since = now;
        if (now - rate.since >= 1000) {
          rate.fps = (rate.count * 1000) / (now - rate.since);
          rate.count = 0;
          rate.since = now;
        }

        const tracked = smoother.push(frame);
        const result = worldFromAnalysis(tracked, adjustRef.current);
        const latched = latch.push(result, tracked.ballsMoving);

        // The overlay path, at full rate. A rejected frame draws the last good
        // reading rather than nothing: menus, pocket animations and the shot
        // itself all produce unusable frames, and blanking on each one is what
        // made the overlay flash up once and then disappear. `onLost` fires
        // only when the hold finally runs out and there is nothing to show.
        if (latched) onVisionRef.current?.(latched);
        else onLostRef.current?.();

        // The control-panel path, throttled.
        if (now - lastUiUpdateRef.current < UI_UPDATE_INTERVAL_MS) return;
        lastUiUpdateRef.current = now;

        setVision(latched);
        setStats({
          frames: frame.frameIndex + 1,
          analysisMs: frame.elapsedMs,
          fps: rate.fps,
          ballCount: tracked.balls.length,
          rejection: isVisionWorld(result) ? null : result.reason,
          clothFraction: frame.clothFraction,
          clothColor: frame.clothColor,
          age: latched?.age ?? 0,
          aimIsLive: tracked.aimIsLive,
        });
      });
    } catch {
      // No native module (web, or a dev client without the module linked).
    }
    return () => sub?.remove();
  }, [smoother, latch]);

  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    try {
      sub = OverlayNative.addListener('onCaptureStateChange', (event) => {
        setRunning(event.running);
        if (!event.running) {
          smoother.reset();
          latch.reset();
          setVision(null);
          setStats(EMPTY_STATS);
          rateRef.current = { count: 0, since: 0, fps: 0 };
          lastUiUpdateRef.current = 0;
        }
        setError(event.reason);
      });
    } catch {
      // As above.
    }
    return () => sub?.remove();
  }, [smoother, latch]);

  // Thresholds are re-read per frame natively, so pushing on change is enough.
  useEffect(() => {
    try {
      OverlayNative.setCaptureConfig(config);
    } catch {
      // Not available; start() will report the real error.
    }
  }, [config]);

  const start = useCallback(async () => {
    try {
      setError(null);
      smoother.reset();
      latch.reset();
      const granted = await OverlayNative.startCapture(config);
      if (!granted) setError('Screen capture was declined.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [config, smoother, latch]);

  /**
   * Makes the analyser read the table colour again on the next frame. Needed
   * only when the player changes table skin and would rather not wait for the
   * detector to notice on its own.
   */
  const relearnCloth = useCallback(() => {
    try {
      OverlayNative.relearnCloth();
    } catch {
      // Not available; nothing to relearn.
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await OverlayNative.stopCapture();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { running, error, vision, stats, start, stop, relearnCloth };
}
