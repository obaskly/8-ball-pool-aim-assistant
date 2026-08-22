import type {
  DetectedBall,
  FrameAnalysis,
} from '../../modules/overlay-native';
import {
  BALL_RADIUS_TO_TABLE_WIDTH,
  CORNER_CAPTURE_TO_TABLE_WIDTH,
  IDENTITY_ADJUSTMENT,
  SIDE_CAPTURE_TO_TABLE_WIDTH,
  TABLE_ASPECT_RATIO,
  type CalibrationAdjustment,
} from '../calibration/tableProfile';
import type { PowerReading } from './power';
import { createRectTable } from '../physics/geometry';
import type { Ball, BallKind, TableGeometry, World } from '../physics/types';
import type { Vec2 } from '../physics/vec2';

/**
 * How far the detected aspect ratio may stray from the measured 1.93 before the
 * frame is rejected. Wide enough for a partly shadowed cushion, tight enough to
 * throw out a menu panel or a replay camera, whose geometry would be nonsense.
 */
const ASPECT_TOLERANCE = 0.3;

/**
 * A frame with fewer balls than this is a bad read rather than a table.
 *
 * One is the real floor: at the end of a rack there is genuinely nothing left
 * but the cue ball and the eight, and on the last shot of the game the eight is
 * on its own. Rejecting those frames would blank the overlay exactly when the
 * shot matters most.
 */
const MIN_BALLS = 1;

export interface VisionWorld {
  world: World;
  /** The cue ball, pulled out for convenience. Never null when `world` is set. */
  cueBall: Ball;
  /** The game's own aim direction, in radians, when it is known. */
  aimAngle: number | null;
  /**
   * How far that guideline ran, in screen pixels, when it was measured on this
   * frame. Null whenever the direction is being held over: the direction stays
   * roughly true while the player thinks, but a distance to the first
   * obstruction stops being a fact about this table the moment anything rolls.
   */
  aimReach: number | null;
  /**
   * Where the game drew the ghost ball, in screen pixels, when it drew one on
   * this frame. Held over exactly as little as `aimReach` is, and for the same
   * reason: it is a fact about a contact that has not happened yet.
   */
  contact: Vec2 | null;
  /**
   * True when the guideline was actually on screen for this frame. False means
   * `aimAngle` is the last direction the player aimed in, held over by the
   * smoother because the game stopped drawing its line.
   */
  aimIsLive: boolean;
  /**
   * The power meter as measured, passed straight through. Turning it into a
   * shot power needs a calibration that outlives any one frame, so that happens
   * upstream — see `estimatePower`.
   */
  power: PowerReading;
}

export interface VisionRejection {
  reason: string;
}

export type VisionResult = VisionWorld | VisionRejection;

export function isVisionWorld(result: VisionResult): result is VisionWorld {
  return (result as VisionWorld).world !== undefined;
}

/**
 * Turn one analysed frame into a physics world.
 *
 * The table is rebuilt from the *detected* playfield rather than from the screen
 * fractions in the calibration profile: the game letterboxes on aspect ratios
 * other than the reference one, so the measured rectangle is right and the
 * predicted one is not. The measured ratios (ball radius, capture radii) still
 * come from the profile — those are properties of the game's art, and they scale
 * with table width on every device.
 *
 * Returns a rejection rather than throwing, because a dropped frame is normal:
 * the analyser sees menus, replays and pocket animations too.
 */
export function worldFromAnalysis(
  analysis: FrameAnalysis & { aimIsLive?: boolean },
  adjust: CalibrationAdjustment = IDENTITY_ADJUSTMENT
): VisionResult {
  if (analysis.note && !analysis.playfield) {
    return { reason: analysis.note };
  }

  const pf = analysis.playfield;
  if (!pf) return { reason: 'no table' };

  const width = pf.right - pf.left;
  const height = pf.bottom - pf.top;
  if (width <= 0 || height <= 0) return { reason: 'degenerate table' };

  // The table seen head-on. Anything far off is a menu, a replay camera or a
  // half-covered table, and its geometry would be nonsense.
  const aspect = width / height;
  if (Math.abs(aspect - TABLE_ASPECT_RATIO) > ASPECT_TOLERANCE) {
    return { reason: `aspect ${aspect.toFixed(2)}` };
  }

  if (analysis.balls.length < MIN_BALLS) {
    return { reason: 'too few balls' };
  }

  const cue = analysis.balls.find((ball) => ball.kind === 'cue');
  if (!cue) return { reason: 'no cue ball' };

  const cx = (pf.left + pf.right) / 2 + adjust.offsetX;
  const cy = (pf.top + pf.bottom) / 2 + adjust.offsetY;
  const halfW = (width / 2) * adjust.scale;
  const halfH = (height / 2) * adjust.scale;

  const table: TableGeometry = createRectTable({
    playfield: {
      left: cx - halfW,
      top: cy - halfH,
      right: cx + halfW,
      bottom: cy + halfH,
    },
    // Derived from table width, not from the measured blob size. Blob radii are
    // biased by shadows and highlights and jitter frame to frame; the ratio does
    // not, and the physics is sensitive to the radius through the ghost ball.
    ballRadius: width * BALL_RADIUS_TO_TABLE_WIDTH * adjust.ballRadiusScale,
    cornerCaptureRadius:
      width * CORNER_CAPTURE_TO_TABLE_WIDTH * adjust.captureRadiusScale,
    sideCaptureRadius:
      width * SIDE_CAPTURE_TO_TABLE_WIDTH * adjust.captureRadiusScale,
  });

  const balls = analysis.balls.map((ball, index) =>
    toBall(ball, index, table.ballRadius)
  );

  const aimIsLive = analysis.aimIsLive ?? analysis.aimAngle !== null;

  return {
    world: { table, balls },
    cueBall: balls.find((ball) => ball.kind === 'cue')!,
    aimAngle: analysis.aimAngle,
    aimReach: aimIsLive ? analysis.aimReach ?? null : null,
    contact:
      aimIsLive && analysis.contactX !== null && analysis.contactY !== null
        ? { x: analysis.contactX, y: analysis.contactY }
        : null,
    aimIsLive,
    power: {
      powerTipY: analysis.powerTipY ?? null,
      powerSlotTop: analysis.powerSlotTop ?? null,
      powerSlotBottom: analysis.powerSlotBottom ?? null,
    },
  };
}

function toBall(
  detected: DetectedBall & { id?: string },
  index: number,
  radius: number
): Ball {
  return {
    // The cue ball is addressed by name throughout the engine. Everything else
    // uses the tracker's stable id when the frame came through the smoother, and
    // falls back to a positional id when it did not.
    id:
      detected.kind === 'cue'
        ? 'cue'
        : detected.id ?? `${detected.kind}-${index}`,
    position: { x: detected.x, y: detected.y },
    radius,
    kind: detected.kind as BallKind,
  };
}
