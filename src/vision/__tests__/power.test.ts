import { describe, expect, it } from 'vitest';

import { estimatePower, seedCalibration, type PowerCalibration } from '../power';

/**
 * The meter as measured on the calibration captures, in screen pixels. The
 * tips are what the shipped native detector reports for frames the player took
 * at a spread of drag positions, one of them held all the way back.
 */
const SLOT_TOP = 237;
const SLOT_BOTTOM = 610;
const REST_TIP = 246.72;
const FULL_TIP = 583.6;
const DRAGGED = [266.06, 348.43, 431.8, 516.4, FULL_TIP];

const frame = (tip: number | null) => ({
  powerTipY: tip,
  powerSlotTop: SLOT_TOP,
  powerSlotBottom: SLOT_BOTTOM,
});

describe('power meter', () => {
  it('reads the resting stick as no power', () => {
    const { power } = estimatePower(frame(REST_TIP), null);
    expect(power).toBeCloseTo(0, 2);
  });

  it('reads full power as full without ever having been calibrated', () => {
    // The seed comes from the slot alone. It has to be good, because a player
    // may never pull all the way back while the app is watching.
    const { power, calibration } = estimatePower(frame(FULL_TIP), null);
    expect(calibration!.settled).toBe(false);
    expect(power).toBeCloseTo(1, 2);
  });

  it('spreads the measured drag positions over the range', () => {
    const got = DRAGGED.map((tip) => estimatePower(frame(tip), null).power!);
    expect(got).toEqual([...got].sort((a, b) => a - b));
    expect(got[0]).toBeGreaterThan(0.02);
    expect(got[got.length - 1]).toBeCloseTo(1, 2);
    // Power per pixel of tip travel is the same everywhere in the range. Note
    // this compares against the tips, not against each other: the drags are a
    // player's, so they are not evenly spaced and never were meant to be.
    const perPixel = got
      .slice(1, 4)
      .map((v, i) => (v - got[i]) / (DRAGGED[i + 1] - DRAGGED[i]));
    for (const s of perPixel) expect(s).toBeCloseTo(perPixel[0], 6);
  });

  it('treats the resting stick as no choice yet, not as a zero-power shot', () => {
    // Predicting zero power would draw a path of no length and blank the
    // overlay for the whole of aiming, which is when it is worth having.
    expect(estimatePower(frame(REST_TIP), null).atRest).toBe(true);
    expect(estimatePower(frame(DRAGGED[0]), null).atRest).toBe(false);
    expect(estimatePower(frame(FULL_TIP), null).atRest).toBe(false);
  });

  it('reports nothing when the meter is off screen', () => {
    const r = estimatePower(
      { powerTipY: null, powerSlotTop: null, powerSlotBottom: null },
      null
    );
    expect(r.power).toBeNull();
  });

  it('keeps what it learned while the meter is hidden', () => {
    const learned: PowerCalibration = { restY: 246, fullY: 580, settled: true };
    const r = estimatePower(
      { powerTipY: null, powerSlotTop: null, powerSlotBottom: null },
      learned
    );
    expect(r.calibration).toBe(learned);
  });

  it('rises monotonically as the stick is dragged down', () => {
    let cal = seedCalibration(SLOT_TOP, SLOT_BOTTOM);
    const seen: number[] = [];
    for (const tip of [246.7, 280, 340, 420, 500, 570]) {
      const r = estimatePower(frame(tip), cal);
      cal = r.calibration!;
      seen.push(r.power!);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    }
    expect(seen[0]).toBeCloseTo(0, 2);
  });

  it('learns full power from the deepest drag it has seen', () => {
    let cal = seedCalibration(SLOT_TOP, SLOT_BOTTOM);
    expect(cal.settled).toBe(false);

    // A drag past the assumed end moves the end and pins it to 1.0.
    const deep = estimatePower(frame(600), cal);
    cal = deep.calibration!;
    expect(deep.power).toBeCloseTo(1, 2);
    expect(cal.settled).toBe(true);
    expect(cal.fullY).toBeCloseTo(600, 2);

    // and the same tip still reads 1.0 next frame
    expect(estimatePower(frame(600), cal).power).toBeCloseTo(1, 2);
    // while a half drag now reads against the learned range
    const half = estimatePower(frame((cal.restY + 600) / 2), cal);
    expect(half.power).toBeCloseTo(0.5, 2);
  });

  it('never leaves 0..1 even past the learned ends', () => {
    const cal: PowerCalibration = { restY: 246, fullY: 580, settled: true };
    expect(estimatePower(frame(100), cal).power).toBe(0);
    expect(estimatePower(frame(900), { ...cal }).power).toBe(1);
  });

  it('starts over when the slot moves', () => {
    const stale: PowerCalibration = { restY: 40, fullY: 300, settled: true };
    const r = estimatePower(frame(REST_TIP), stale);
    // rotated or resized: the old pixels mean nothing, so it reseeds and the
    // resting stick reads as no power again rather than as most of a shot
    expect(r.power).toBeCloseTo(0, 2);
    expect(r.calibration!.restY).toBeGreaterThan(SLOT_TOP);
  });

  it('tracks a drag linearly once calibrated', () => {
    const cal: PowerCalibration = { restY: 246.7, fullY: 596.7, settled: true };
    for (const [tip, want] of [
      [246.7, 0],
      [334.2, 0.25],
      [421.7, 0.5],
      [509.2, 0.75],
      [596.7, 1],
    ] as const) {
      expect(estimatePower(frame(tip), cal).power).toBeCloseTo(want, 3);
    }
  });
});
