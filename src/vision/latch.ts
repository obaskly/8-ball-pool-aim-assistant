import { isVisionWorld, type VisionResult, type VisionWorld } from './worldFromAnalysis';

export interface LatchOptions {
  /**
   * How many consecutive unusable frames the last good reading survives.
   *
   * A stream of rejections is normal and short: the pocket animation, the
   * between-shots camera drift, a menu sliding in, the moment a HUD panel
   * covers a cushion. Blanking on each one is what made the overlay strobe.
   * Past this many frames the table really is gone and the overlay clears.
   */
  holdFrames: number;
  /**
   * After this many frames without a fresh reading, the overlay starts fading
   * towards `minFade`, reaching it at `holdFrames`. A prediction that is a
   * second out of date should not look as confident as a live one.
   */
  fadeAfterFrames: number;
  /** Alpha the overlay has decayed to by the time the hold expires. */
  minFade: number;
}

export const DEFAULT_LATCH: LatchOptions = {
  // At 15 fps: about two thirds of a second of coasting. It was two seconds,
  // which is far too long when a turn is on a timer — a held reading carries a
  // live-looking aim with it, so a long hold is another way to show lines for a
  // shot that has already been played.
  holdFrames: 10,
  fadeAfterFrames: 3,
  minFade: 0.3,
};

export interface LatchedVision extends VisionWorld {
  /** Frames since this reading was actually taken. 0 means it is current. */
  age: number;
  /** Alpha the overlay should be drawn at, 1 when current. */
  fade: number;
  /** Why the current frame was unusable, or null when it was fine. */
  rejection: string | null;
}

/**
 * Keeps the last usable reading on screen while the detector misses.
 *
 * The pipeline in front of this is per-frame and stateless by design, so any
 * single bad frame used to take the whole overlay with it. That is the bug
 * behind "it shows the lines once and then they disappear": the game stops
 * drawing its guideline the instant a shot is struck, and half the frames in
 * an ordinary rally are unusable for one reason or another.
 *
 * Note that holding a *reading* is not the same as freezing the picture. The
 * caller re-runs the prediction every frame, so as long as fresh readings keep
 * arriving the lines track the balls; the hold only covers the gaps.
 */
export class VisionLatch {
  private readonly options: LatchOptions;
  private last: VisionWorld | null = null;
  private age = 0;

  constructor(options: Partial<LatchOptions> = {}) {
    this.options = { ...DEFAULT_LATCH, ...options };
  }

  reset(): void {
    this.last = null;
    this.age = 0;
  }

  /**
   * The reading to draw this frame, or null when there is nothing to draw.
   *
   * @param moving whether a ball moved since the last frame. A held reading is
   *   a snapshot of a table that has since changed, which is harmless while the
   *   player is aiming and nothing is moving, and actively wrong once the balls
   *   are rolling: it draws the shot that has just been played over the balls
   *   playing it out. So the hold is abandoned rather than counted down.
   */
  push(result: VisionResult, moving = false): LatchedVision | null {
    if (isVisionWorld(result)) {
      this.last = result;
      this.age = 0;
      return { ...result, age: 0, fade: 1, rejection: null };
    }

    if (!this.last) return null;

    if (moving) {
      this.last = null;
      this.age = 0;
      return null;
    }

    this.age += 1;
    if (this.age > this.options.holdFrames) {
      this.last = null;
      return null;
    }

    return {
      ...this.last,
      age: this.age,
      fade: this.fadeAt(this.age),
      rejection: result.reason,
    };
  }

  private fadeAt(age: number): number {
    const { fadeAfterFrames, holdFrames, minFade } = this.options;
    if (age <= fadeAfterFrames) return 1;
    const span = Math.max(1, holdFrames - fadeAfterFrames);
    const t = Math.min(1, (age - fadeAfterFrames) / span);
    return 1 + (minFade - 1) * t;
  }
}
