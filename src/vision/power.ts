/**
 * Turn the power meter's ferrule position into a 0..1 shot power.
 *
 * Native reports where the tip is and where the slot runs, but not what those
 * pixels are worth, because only half of that is knowable from one frame. The
 * top of the slot is unambiguous — the stick rests there, so that is no power —
 * but the bottom of the slot is not the bottom of the stick's travel, and no
 * single frame says where that is.
 *
 * So this watches instead. The tip never goes above its rest position and never
 * below full power, so the extremes seen across a session bracket the range
 * exactly, and a few shots of ordinary play find them. Until then it falls back
 * to the slot geometry, which is close enough to be useful and is corrected the
 * first time a real drag beats it.
 *
 * What this buys, in rough order of how much it matters:
 *
 *   path length   every path is drawn for `power^2 * fullPowerTravel` pixels.
 *                 That is 240 px at 0.2 against 6000 at 1.0, so guessing power
 *                 wrong draws cushion rebounds that will never happen, on every
 *                 single shot.
 *   depart angle  power sets the slide distance, so it sets how rolled the cue
 *                 ball is at impact. But only while it is still sliding: past
 *                 `travel >= slide` it is fully rolled and power stops mattering
 *                 to the angle entirely. That makes this a short-shot effect,
 *                 worth nothing on a long one and up to ~57 degrees on a tap.
 */

/** What native measured, straight off `FrameAnalysis`. */
export interface PowerReading {
  powerTipY: number | null;
  powerSlotTop: number | null;
  powerSlotBottom: number | null;
}

export interface PowerCalibration {
  /** Tip y at rest, which is zero power. */
  restY: number;
  /** Tip y at the bottom of the drag, which is full power. */
  fullY: number;
  /** True once both ends come from real observations rather than the slot. */
  settled: boolean;
}

export interface PowerEstimate {
  /** 0..1, or null when the meter was not on screen. */
  power: number | null;
  /**
   * The stick is sitting at the top, so the player is still aiming and has not
   * chosen a power. Callers should fall back to their own default rather than
   * treat this as a shot of no power, which would predict a path of no length
   * and blank the overlay over the whole of aiming — which is precisely when it
   * is worth having.
   */
  atRest: boolean;
  calibration: PowerCalibration | null;
}

/**
 * Where the tip sits at each end of its travel, as a fraction of the slot.
 * Measured off calibration captures: at rest the ferrule is a little below the
 * top of the slot, and at full power it stops well short of the bottom, because
 * the stick is longer than the slot and is clipped rather than run out of it.
 *
 * These are only the starting guess. They are close enough that an uncalibrated
 * meter reads full power as 100.0% and rest as 0.0% on the frames they came
 * from, but a different phone will differ and the observed extremes below take
 * over as soon as they beat these.
 */
const REST_FRACTION = 0.026;
const FULL_FRACTION = 0.929;

/**
 * Below this the stick has not really been pulled and the player has not chosen
 * a power yet — they are still aiming. Worth about seven pixels of travel.
 */
const REST_DEADBAND = 0.02;

/** Ignore a slot that jumped: the meter does not move, so that is a misread. */
const SLOT_JUMP_TOLERANCE = 8;

/** A drag has to beat the known end by this much to move it, in pixels. */
const EXTREME_MARGIN = 1.5;

export function seedCalibration(
  slotTop: number,
  slotBottom: number
): PowerCalibration {
  const span = slotBottom - slotTop;
  return {
    restY: slotTop + span * REST_FRACTION,
    fullY: slotTop + span * FULL_FRACTION,
    settled: false,
  };
}

/**
 * Fold one frame into the running calibration and read the power off it.
 *
 * `prior` is the calibration from the previous frame, or null to start fresh.
 * The returned calibration should be carried into the next call.
 */
export function estimatePower(
  reading: PowerReading,
  prior: PowerCalibration | null
): PowerEstimate {
  const { powerTipY: tip, powerSlotTop: top, powerSlotBottom: bottom } = reading;

  // No meter on screen: not our shot. Keep what we learned for next time.
  if (top === null || bottom === null || bottom - top < 4) {
    return { power: null, atRest: false, calibration: prior };
  }

  const seeded = seedCalibration(top, bottom);

  // If the slot has moved the game has been resized or rotated and the old
  // pixel positions mean nothing.
  let cal =
    prior === null || Math.abs(prior.restY - seeded.restY) > SLOT_JUMP_TOLERANCE
      ? seeded
      : prior;

  if (tip === null) {
    return { power: null, atRest: false, calibration: cal };
  }

  // The tip brackets its own range: above anything seen is a better rest, below
  // anything seen is a better full.
  if (tip < cal.restY - EXTREME_MARGIN) {
    cal = { ...cal, restY: tip };
  }
  if (tip > cal.fullY + EXTREME_MARGIN) {
    cal = { ...cal, fullY: tip, settled: true };
  }

  const span = cal.fullY - cal.restY;
  if (span < 4) {
    return { power: null, atRest: false, calibration: cal };
  }

  const p = Math.min(1, Math.max(0, (tip - cal.restY) / span));
  return { power: p, atRest: p <= REST_DEADBAND, calibration: cal };
}
