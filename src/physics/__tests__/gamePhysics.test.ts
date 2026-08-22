import { describe, expect, it } from 'vitest';

import {
  BALL_RADIUS_CM,
  ROLL_DECEL,
  SLIDE_DECEL,
  SLIP_DECAY,
  TABLE_ASPECT_EXACT,
  TICK_SECONDS,
  freeRunDistance,
  fullPowerTravelWidths,
  launchSpeed,
  rollingRunDistance,
} from '../gamePhysics';

/**
 * Step the game's own `calcVelocity` — a transcription of it, used here only to
 * check that the closed forms above agree with actually running the thing.
 */
function tickTo(speed: number): number {
  let vx = speed;
  let vy = 0;
  let sx = 0;
  let sy = 0;
  let travelled = 0;
  for (let i = 0; i < 2_000_000; i++) {
    const v = Math.hypot(vx, vy);
    if (v < 1e-9) break;
    travelled += v * TICK_SECONDS;
    const s15 = BALL_RADIUS_CM * sx - vy;
    const s16 = -vx - sy * BALL_RADIUS_CM;
    const slip = Math.hypot(s16, s15);
    const slipTime = slip / SLIP_DECAY;
    if (slipTime > 1e-11) {
      const dt = Math.min(slipTime, TICK_SECONDS);
      const k = (SLIDE_DECEL * dt) / slip;
      const dx = s16 * k;
      const dy = s15 * k;
      vx += dx;
      vy += dy;
      sx -= (dy * 2.5) / BALL_RADIUS_CM;
      sy += (dx * 2.5) / BALL_RADIUS_CM;
    }
    if (slipTime < TICK_SECONDS) {
      const sp = Math.hypot(vx, vy);
      if (sp > 0) {
        const drop = (TICK_SECONDS - slipTime) * ROLL_DECEL;
        const f = Math.max(0, 1 - drop / sp);
        vx *= f;
        vy *= f;
        sx = vy / BALL_RADIUS_CM;
        sy = -vx / BALL_RADIUS_CM;
      }
    }
  }
  return travelled;
}

describe('the game constants hang together', () => {
  it('has slip dying at exactly 7/2 the sliding deceleration', () => {
    // The textbook figure for a uniform sphere. That the game's two numbers
    // land on it is what says these are physical constants, not tuned ones.
    expect(SLIP_DECAY / SLIDE_DECEL).toBeCloseTo(3.5, 10);
  });

  it('reads as mu = 0.2 sliding and 0.0111 rolling under g = 980 cm/s^2', () => {
    expect(SLIDE_DECEL / 980).toBeCloseTo(0.2, 6);
    expect(ROLL_DECEL / 980).toBeCloseTo(0.0111, 4);
  });

  it('puts the table at exactly 2:1, not the 1.9262 we measured off cloth', () => {
    expect(TABLE_ASPECT_EXACT).toBe(2);
  });
});

describe('closed forms match running the simulation', () => {
  // The tick loop advances by the velocity it had at the *start* of each tick,
  // so it overshoots slightly — plain forward Euler. The closed form is the
  // exact continuous answer, and the two sit within a tenth of a percent, which
  // is far inside anything an overlay can show.
  const RELATIVE = 1e-3;

  it('agrees with the tick loop on a full-power run', () => {
    const v = launchSpeed(1);
    expect(Math.abs(freeRunDistance(v) / tickTo(v) - 1)).toBeLessThan(RELATIVE);
  });

  it('agrees at a soft shot too', () => {
    const v = launchSpeed(0.3);
    expect(Math.abs(freeRunDistance(v) / tickTo(v) - 1)).toBeLessThan(RELATIVE);
  });

  it('drops a ball to 5/7 of its speed by the time it rolls', () => {
    // Straight out of the slide phase: the ball loses 2/7, every time.
    const v = 700;
    const slide =
      (v * v * (SLIP_DECAY - SLIDE_DECEL / 2)) / (SLIP_DECAY * SLIP_DECAY);
    const total = freeRunDistance(v);
    expect(total - slide).toBeCloseTo(rollingRunDistance((5 / 7) * v), 6);
  });
});

describe('the power curve', () => {
  it('is convex, not linear: half a meter is 29% of the speed', () => {
    expect(launchSpeed(0.5) / launchSpeed(1)).toBeCloseTo(0.2929, 4);
    expect(launchSpeed(0.25) / launchSpeed(1)).toBeCloseTo(0.134, 3);
    expect(launchSpeed(0.75) / launchSpeed(1)).toBeCloseTo(0.5, 4);
  });

  it('is why power^2 drew paths up to 3.8x too long', () => {
    // The old model's travel against the real one, as a ratio. Anything above
    // 1 is a path drawn longer than the ball will ever run — which is how we
    // ended up predicting cushion rebounds that never happened.
    const full = freeRunDistance(launchSpeed(1));
    const overshoot = (p: number) => (p * p) / (freeRunDistance(launchSpeed(p)) / full);
    expect(overshoot(0.1)).toBeCloseTo(3.79, 1);
    expect(overshoot(0.5)).toBeCloseTo(2.91, 1);
    expect(overshoot(0.9)).toBeCloseTo(1.73, 1);
    expect(overshoot(1.0)).toBeCloseTo(1.0, 6);
  });

  it('runs 76.8 table lengths at full power on the strongest cue', () => {
    expect(fullPowerTravelWidths()).toBeCloseTo(76.84, 1);
  });

  it('lets a rolling ball run 1.86x further than one just struck', () => {
    // The reason one travel-budget constant cannot serve both: a ball coming
    // off a cushion is already rolling and has no 2/7 left to lose.
    const v = 400;
    expect(rollingRunDistance(v) / freeRunDistance(v)).toBeCloseTo(1.861, 2);
  });
});
