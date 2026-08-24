import type { DetectedBall, FrameAnalysis } from '../../modules/overlay-native';
import { BALL_RADIUS_TO_TABLE_WIDTH } from '../calibration/tableProfile';

/** A detection carrying an identity that survives across frames. */
export interface TrackedBall extends DetectedBall {
  id: string;
  /** Frames since this ball was last actually seen. 0 means seen this frame. */
  missed: number;
}

export interface TrackedFrame extends Omit<FrameAnalysis, 'balls'> {
  balls: TrackedBall[];
  /** True when the guideline was really on screen this frame, not held over. */
  aimIsLive: boolean;
  /** Frames since a guideline was last seen. 0 while one is on screen. */
  aimAge: number;
  /**
   * True when a ball moved further between these two frames than jitter can
   * account for — which means the shot has been struck.
   *
   * This is the one signal that separates "the guideline flickered" from "the
   * game took the guideline away because the balls are rolling", and the two
   * want opposite treatment: the first should be ridden out, the second should
   * blank the overlay at once.
   */
  ballsMoving: boolean;
}

export interface SmoothingOptions {
  /**
   * EMA weight for the playfield rectangle. Low, because the table does not
   * move: this is pure noise rejection, and lag costs nothing.
   */
  playfieldAlpha: number;
  /**
   * EMA weight for ball positions. Higher, because balls really do move and the
   * overlay has to keep up with a rolling cue ball.
   */
  ballAlpha: number;
  /** EMA weight for the aim angle, applied on the shorter way round the circle. */
  aimAlpha: number;
  /** Match radius for frame-to-frame ball association, in ball radii. */
  matchRadii: number;
  /**
   * How many consecutive frames a ball may go undetected before it is dropped.
   * A ball crossing a cushion shadow can vanish for a frame or two.
   */
  missTolerance: number;
  /**
   * How far a ball has to move between frames, in ball radii, before the table
   * counts as in motion rather than jittering.
   *
   * Detection noise is a pixel or so; the slowest ball worth calling moving
   * covers several. Half a radius sits between them with room either side at
   * any capture rate the app runs at.
   */
  motionRadii: number;
  /**
   * How many frames the last aim direction is held after the guideline goes.
   *
   * The game only draws its guideline while the player is actually aiming: it
   * disappears the instant the shot is taken, and there is none at all during
   * ball-in-hand or while the balls are still rolling. Dropping the direction
   * with it is what made the overlay flash up once and then vanish. Holding it
   * keeps the lines on screen, and because the prediction is recomputed from
   * live ball positions every frame they still track the table rather than
   * freezing. Zero disables the hold and restores the old blanking behaviour.
   */
  aimHoldFrames: number;
}

export const DEFAULT_SMOOTHING: SmoothingOptions = {
  playfieldAlpha: 0.15,
  ballAlpha: 0.45,
  aimAlpha: 0.35,
  matchRadii: 1.6,
  motionRadii: 0.5,
  // At 15 fps this is about half a second. Long enough to ride out a ball
  // passing through a cushion shadow or behind the game's own HUD.
  missTolerance: 8,
  // Effectively "until the next guideline". A stale direction is far better
  // than an empty screen, and it is replaced the moment the player aims again.
  // Four frames, about a quarter second at 15 fps. Long enough to ride out the
  // guideline flickering behind the cue stick or a HUD panel, short enough that
  // it is gone almost immediately once you actually shoot.
  //
  // This used to be Infinity, which meant the last aim ever seen was held for
  // ever: after a shot the overlay went on predicting from a dead aim while
  // tracking the balls as they moved, so it looked live and was worthless. You
  // then had to wait it out before getting a reading for your next shot.
  aimHoldFrames: 4,
};

/**
 * Stabilises the detector's output.
 *
 * Raw per-frame detection jitters by a pixel or two, which is invisible in the
 * ball positions but very visible at the far end of a long trajectory line —
 * a 1 px error at the cue ball becomes tens of pixels three cushions later. It
 * also assigns ball identities, which the analyser cannot: it re-derives its
 * blobs from scratch every frame and has no notion of the previous one.
 */
export class FrameSmoother {
  private readonly options: SmoothingOptions;
  private playfield: FrameAnalysis['playfield'] = null;
  private balls: TrackedBall[] = [];
  private aimAngle: number | null = null;
  private aimReach: number | null = null;
  private contactX: number | null = null;
  private contactY: number | null = null;
  private aimAge = 0;
  private nextId = 0;
  /** Largest distance a tracked ball moved on the last frame, in radii. */
  private motion = 0;

  constructor(options: Partial<SmoothingOptions> = {}) {
    this.options = { ...DEFAULT_SMOOTHING, ...options };
  }

  reset(): void {
    this.playfield = null;
    this.balls = [];
    this.aimAngle = null;
    this.aimReach = null;
    this.contactX = null;
    this.contactY = null;
    this.aimAge = 0;
    this.nextId = 0;
    this.motion = 0;
  }

  push(frame: FrameAnalysis): TrackedFrame {
    const playfield = this.smoothPlayfield(frame.playfield);
    const scale = playfield ? playfield.right - playfield.left : 0;
    // Fall back to the reported blob radius when there is no table yet.
    const radius =
      scale > 0
        ? scale * BALL_RADIUS_TO_TABLE_WIDTH
        : frame.balls[0]?.radius ?? 10;

    const balls = this.smoothBalls(frame.balls, radius);
    const moving = this.motion > this.options.motionRadii;
    const aimAngle = this.smoothAim(frame.aimAngle, moving);
    const aimReach = this.smoothReach(frame.aimAngle === null ? null : frame.aimReach);
    const live = frame.aimAngle !== null;
    const contactX = this.smoothContact('contactX', live ? frame.contactX : null);
    const contactY = this.smoothContact('contactY', live ? frame.contactY : null);

    return {
      ...frame,
      playfield,
      balls,
      aimAngle,
      aimReach,
      contactX,
      contactY,
      aimIsLive: frame.aimAngle !== null,
      aimAge: this.aimAge,
      ballsMoving: moving,
    };
  }

  private smoothPlayfield(
    next: FrameAnalysis['playfield']
  ): FrameAnalysis['playfield'] {
    if (!next) return this.playfield;

    const previous = this.playfield;
    if (!previous) {
      this.playfield = next;
      return next;
    }

    const a = this.options.playfieldAlpha;
    this.playfield = {
      left: mix(previous.left, next.left, a),
      top: mix(previous.top, next.top, a),
      right: mix(previous.right, next.right, a),
      bottom: mix(previous.bottom, next.bottom, a),
    };
    return this.playfield;
  }

  /**
   * Greedy nearest-neighbour association.
   *
   * Balls are far apart relative to how far they travel between frames at 15 fps,
   * so greedy matching is as good as the Hungarian algorithm here and costs
   * nothing. Each previous track claims at most one detection and vice versa.
   */
  private smoothBalls(
    detections: DetectedBall[],
    radius: number
  ): TrackedBall[] {
    const previous = this.balls;
    const limit = radius * this.options.matchRadii;
    const claimed = new Array<boolean>(detections.length).fill(false);
    const out: TrackedBall[] = [];
    const a = this.options.ballAlpha;

    for (const track of this.balls) {
      let bestIndex = -1;
      let bestDistance = limit;

      for (let i = 0; i < detections.length; i++) {
        if (claimed[i]) continue;
        const d = distance(track, detections[i]);
        if (d < bestDistance) {
          bestDistance = d;
          bestIndex = i;
        }
      }

      if (bestIndex < 0) {
        // Not seen this frame. Coast on the last known position for a moment
        // rather than making the ball flicker out of the prediction.
        if (track.missed + 1 <= this.options.missTolerance) {
          out.push({ ...track, missed: track.missed + 1 });
        }
        continue;
      }

      claimed[bestIndex] = true;
      const found = detections[bestIndex];
      out.push({
        ...found,
        id: track.id,
        // A ball's class is stable; a single frame's classification is not.
        // Keep the established class unless the new read is more confident.
        kind: found.confidence >= track.confidence ? found.kind : track.kind,
        confidence: mix(track.confidence, found.confidence, a),
        x: mix(track.x, found.x, a),
        y: mix(track.y, found.y, a),
        radius: mix(track.radius, found.radius, a),
        missed: 0,
      });
    }

    for (let i = 0; i < detections.length; i++) {
      if (claimed[i]) continue;
      out.push({ ...detections[i], id: `b${this.nextId++}`, missed: 0 });
    }

    this.motion = this.measureMotion(detections, previous, radius);
    this.balls = keepOneCueBall(out);
    return this.balls;
  }

  /**
   * How far this frame's detections sit from where the balls were, in radii.
   *
   * Deliberately *not* measured over the matched pairs. The association window
   * is 1.6 radii wide, and a struck ball clears that in a single frame, so the
   * balls that carry the news are exactly the ones matching cannot see: they
   * come through as a lost track and an unrelated new detection, and the pairs
   * that do match are the ones that never moved. Asking each detection how far
   * it is from the nearest ball of the previous frame has no such blind spot —
   * a table at rest answers a pixel, and a rolling ball answers its own travel.
   */
  private measureMotion(
    detections: DetectedBall[],
    previous: TrackedBall[],
    radius: number
  ): number {
    if (radius <= 0 || previous.length === 0 || detections.length === 0) return 0;
    let worst = 0;
    for (const found of detections) {
      let nearest = Infinity;
      for (const track of previous) {
        const d = distance(track, found);
        if (d < nearest) nearest = d;
      }
      if (nearest > worst) worst = nearest;
    }
    return worst / radius;
  }

  private smoothAim(next: number | null, moving: boolean): number | null {
    if (next === null) {
      this.aimAge += 1;
      // Balls rolling and no guideline is not a flicker to ride out: it is the
      // shot, already struck. Holding the aim through it is what draws lines
      // that follow the balls around after they have been hit — they look live,
      // they describe a shot that is over, and they are the reason the hold is
      // dropped here rather than counted down. See `aimHoldFrames`.
      if (moving || this.aimAge > this.options.aimHoldFrames) this.aimAngle = null;
      return this.aimAngle;
    }

    this.aimAge = 0;
    if (this.aimAngle === null) {
      this.aimAngle = next;
      return next;
    }

    // Take the shorter way round, so a line crossing due-west does not spin the
    // smoothed angle all the way back through zero.
    const delta = normalizeAngle(next - this.aimAngle);
    this.aimAngle = normalizeAngle(this.aimAngle + delta * this.options.aimAlpha);
    return this.aimAngle;
  }

  /**
   * The guideline's length, smoothed while it is on screen and dropped the
   * moment it is not.
   *
   * Nothing is held here, unlike the direction. A held direction is a good guess
   * at where the player is still aiming; a held length is a measurement of a
   * table that has since been broken up by the shot, and it would be used to
   * pick between obstructions that have all moved.
   *
   * The jitter it does have is a fraction of a ball radius, well inside the
   * tolerance the engine compares against, so the filter is only here to stop
   * the choice flipping back and forth on a frame where two candidates are
   * nearly equidistant.
   */
  /**
   * Same treatment as the reach, and for the same reason: a contact point is a
   * claim about a collision that has not happened yet, so it is dropped outright
   * the moment the game stops drawing its line rather than held over.
   */
  private smoothContact(
    key: 'contactX' | 'contactY',
    next: number | null
  ): number | null {
    if (next === null) {
      this[key] = null;
      return null;
    }
    this[key] = this[key] === null ? next : mix(this[key]!, next, this.options.aimAlpha);
    return this[key];
  }

  private smoothReach(next: number | null): number | null {
    if (next === null) {
      this.aimReach = null;
      return null;
    }

    this.aimReach =
      this.aimReach === null
        ? next
        : mix(this.aimReach, next, this.options.aimAlpha);
    return this.aimReach;
  }
}

/**
 * There is exactly one cue ball on a table, so there is exactly one here.
 *
 * The classifier scores each ball independently, and on a frame where the eight
 * catches the table light or a stripe turns its white band to the camera, two
 * balls can clear the cue threshold at once. The engine addresses the cue ball
 * by name, so a second one would silently take over the shot. Keep the whitest
 * and demote the rest to stripes, which is what a mostly-white ball is.
 */
function keepOneCueBall(balls: TrackedBall[]): TrackedBall[] {
  let best = -1;
  let bestConfidence = -1;
  let count = 0;

  for (let i = 0; i < balls.length; i++) {
    if (balls[i].kind !== 'cue') continue;
    count += 1;
    if (balls[i].confidence > bestConfidence) {
      bestConfidence = balls[i].confidence;
      best = i;
    }
  }

  if (count <= 1) return balls;
  return balls.map((ball, i) =>
    ball.kind === 'cue' && i !== best ? { ...ball, kind: 'stripe' as const } : ball
  );
}

function mix(previous: number, next: number, alpha: number): number {
  return previous + (next - previous) * alpha;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Folds an angle into [-pi, pi]. Both endpoints are fixed points. */
export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
