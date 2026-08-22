import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  OverlayNative,
  type OverlayDisplayMetrics,
  type OverlayScene,
} from '../../modules/overlay-native';
import { REFERENCE_RESOLUTION } from '../calibration/tableProfile';

/** Used only if the native module cannot be reached (e.g. running in a browser). */
const FALLBACK_METRICS: OverlayDisplayMetrics = {
  width: REFERENCE_RESOLUTION.width,
  height: REFERENCE_RESOLUTION.height,
  density: 2.75,
};

export interface OverlayApi {
  permission: boolean;
  running: boolean;
  metrics: OverlayDisplayMetrics;
  error: string | null;
  /** Whether the floating chip that reopens this panel is showing. */
  bubble: boolean;
  refresh: () => void;
  requestPermission: () => Promise<void>;
  start: (interactive?: boolean) => Promise<void>;
  stop: () => Promise<void>;
  setInteractive: (interactive: boolean) => void;
  setBubble: (visible: boolean) => void;
  push: (scene: OverlayScene) => void;
}

/**
 * Thin state wrapper around the native overlay module.
 *
 * Permission is re-read whenever the app comes back to the foreground, because
 * the only way to grant it is to leave for the system settings screen.
 */
export function useOverlay(): OverlayApi {
  const [permission, setPermission] = useState(false);
  const [running, setRunning] = useState(false);
  const [metrics, setMetrics] = useState<OverlayDisplayMetrics>(FALLBACK_METRICS);
  const [error, setError] = useState<string | null>(null);
  const [bubble, setBubbleState] = useState(true);

  const refresh = useCallback(() => {
    try {
      setPermission(OverlayNative.checkOverlayPermission());
      setRunning(OverlayNative.isOverlayVisible());
      setMetrics(OverlayNative.getDisplayMetrics());
      setBubbleState(OverlayNative.isBubbleVisible());
      setError(null);
    } catch (e) {
      setError(describe(e));
    }
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // The service can also stop from its own notification action.
  useEffect(() => {
    try {
      const sub = OverlayNative.addListener('onOverlayStateChange', (event) => {
        setRunning(event.visible);
      });
      return () => sub.remove();
    } catch {
      return;
    }
  }, []);

  const requestPermission = useCallback(async () => {
    try {
      setPermission(await OverlayNative.requestOverlayPermission());
      setError(null);
    } catch (e) {
      setError(describe(e));
    }
  }, []);

  const start = useCallback(async (interactive = false) => {
    try {
      await OverlayNative.showOverlay(interactive);
      setError(null);
    } catch (e) {
      setError(describe(e));
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await OverlayNative.hideOverlay();
      setError(null);
    } catch (e) {
      setError(describe(e));
    }
  }, []);

  const setInteractive = useCallback((interactive: boolean) => {
    try {
      OverlayNative.setInteractive(interactive);
    } catch (e) {
      setError(describe(e));
    }
  }, []);

  const setBubble = useCallback((visible: boolean) => {
    setBubbleState(visible);
    try {
      OverlayNative.setBubbleVisible(visible);
    } catch (e) {
      setError(describe(e));
    }
  }, []);

  const push = useCallback((scene: OverlayScene) => {
    try {
      OverlayNative.setScene(scene);
    } catch {
      // A dropped frame is not worth surfacing; the next push will retry.
    }
  }, []);

  return {
    permission,
    running,
    metrics,
    error,
    bubble,
    refresh,
    requestPermission,
    start,
    stop,
    setInteractive,
    setBubble,
    push,
  };
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
