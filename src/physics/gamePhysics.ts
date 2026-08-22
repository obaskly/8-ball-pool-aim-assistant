/**
 * 8 Ball Pool's own physics, in the game's own units.
 *
 * Everything here is transcribed from the game rather than chosen by us. The
 * source is PoolPredictor's `Prediction.cpp`, which is a reimplementation of
 * 8 Ball Pool 5.8.0's decompiled physics — its functions still carry the IDA
 * addresses they came from (`sub_1C29FA0` and friends) — so these are the
 * numbers the game itself runs on, not a model fitted to screenshots.
 *
 * The units turn out to be plain physical ones, which is the tell that they are
 * real: the table is 254 x 127 **centimetres**, the size of a 9-foot table, and
 * with g = 980 cm/s^2 the two friction constants come out as mu_slide = 0.2 and
 * mu_roll = 0.0111. The slip decay is exactly 7/2 of the sliding deceleration,
 * which is the textbook figure for a sphere. Nothing here was tuned by hand.
 *
 * We work in centimetres throughout and convert at the boundary, because the
 * constants only mean anything at that scale. The conversion is fixed by the
 * one measurement we trust: `pxPerCm = playfieldWidthPx / TABLE_WIDTH_CM`.
 */

/** Ball radius. The game's value, to all the digits it carries. */
export const BALL_RADIUS_CM = 3.800475;

/** Playing surface, cushion face to cushion face. Exactly 2:1. */
export const TABLE_WIDTH_CM = 254.0;
export const TABLE_HEIGHT_CM = 127.0;

/**
 * The game's aspect ratio, exactly. Worth stating on its own because our own
 * cloth measurement came out at 1.9262, and the 3.8% between them is not
 * measurement noise — it skews x against y, which tilts every angle we predict.
 */
export const TABLE_ASPECT_EXACT = TABLE_WIDTH_CM / TABLE_HEIGHT_CM; // 2

/**
 * Ball radius as a fraction of the playing width. The exact number behind our
 * measured 0.015456, which was 3.3% high.
 */
export const BALL_RADIUS_TO_WIDTH_EXACT = BALL_RADIUS_CM / TABLE_WIDTH_CM; // 0.0149625

/** Simulation tick. The game steps at 200 Hz. */
export const TICK_SECONDS = 0.005;

/**
 * Deceleration of a *sliding* ball, cm/s^2. This is mu_slide * g with
 * mu_slide = 0.2, g = 980.
 */
export const SLIDE_DECEL = 196.0;

/**
 * Rate at which the contact patch's slip dies away, cm/s^2. Exactly 7/2 of
 * `SLIDE_DECEL`, which is what a uniform sphere gives: the ball is slowing by
 * `a` while spinning up by `(5/2)(a/R)`, and the two close the gap at `(7/2)a`.
 */
export const SLIP_DECAY = 686.0;

/**
 * Deceleration of a *rolling* ball, cm/s^2 — mu_roll * g with mu_roll = 0.0111.
 * Eighteen times gentler than sliding, which is why the slide is over in the
 * first few percent of a shot and nearly every ball arrives rolling.
 */
export const ROLL_DECEL = 10.878;

/** 5/2R. Converts a change in surface velocity into the spin that caused it. */
export const SPIN_PER_VELOCITY = 2.5 / BALL_RADIUS_CM;

/** Cushion restitution, applied to the *normal* component only. */
export const CUSHION_RESTITUTION = 0.804;

/** Coulomb friction along the cushion face, capping the tangential change. */
export const CUSHION_FRICTION = 0.4;

/** Follow the cushion imparts, per unit of incoming normal speed: 0.54/R. */
export const CUSHION_SPIN_GAIN = 0.54 / BALL_RADIUS_CM;

/** Rate at which english bleeds away, cm/s^2. */
export const ENGLISH_DECAY = 9.8;

/**
 * Pocket capture. A ball is *pulled* once its centre is within `POCKET_RADIUS`
 * of a pocket centre and is swallowed once within one ball radius. The pull is
 * what makes 8 Ball Pool's pockets as forgiving as they feel — a ball that only
 * clips the mouth still drops.
 */
export const POCKET_RADIUS_CM = 8.0;
export const POCKET_PULL = 120.0;

/**
 * Cue speed at a full-power shot, cm/s, by cue tier. The weakest cue in the
 * game hits at 666 and the strongest at 888.85 — a 33% spread, and the reason
 * a single "full power travel" number cannot be right for every player.
 */
export const CUE_POWER_CM_S = [
  666.0, 682.0, 699.0, 715.0, 731.0, 747.0, 764.0, 780.0, 796.0, 813.0, 828.85,
  848.85, 868.85, 888.85,
] as const;

/** What an unmodified mid-range cue hits at. */
export const DEFAULT_CUE_POWER = 888.85;

/**
 * Turn a power meter reading into a launch speed.
 *
 * This is the single biggest correction the game's own code makes to ours. The
 * meter is **not** linear in speed and the path is not proportional to the
 * square of the meter: the game runs the fraction through `1 - sqrt(1 - p)`
 * first, which is strongly convex. Half a meter of pull is 29% of full speed,
 * not 50%, and a quarter is 13%.
 *
 * Against our old `power^2` travel model that made every path we drew between
 * 1.7x and 3.8x too long, worst at the soft end where most shots live — so we
 * were drawing cushion rebounds that the ball was never going to reach.
 */
export function launchSpeed(power: number, cuePower = DEFAULT_CUE_POWER): number {
  return launchFraction(power) * cuePower;
}

/**
 * The meter's shape on its own, normalised so that full power is 1 — the same
 * curve as `launchSpeed` without committing to a cue. This is what an engine
 * working in normalised speed wants.
 */
export function launchFraction(power: number): number {
  const p = Math.min(1, Math.max(0, power));
  return 1 - Math.sqrt(1 - p);
}

/**
 * How far a ball struck through its centre at `speed` runs before stopping,
 * with nothing in its way.
 *
 * It slides first, losing 2/7 of its speed over a short distance, then rolls
 * the rest away. Both phases are quadratic in speed, so the total is too, and
 * the closed form below is exact rather than a fit — it agrees with the tick
 * simulation to five figures.
 */
export function freeRunDistance(speed: number): number {
  // Slide: it lasts t = v/SLIP_DECAY, over which the ball covers v*t - (a/2)t^2
  // at a = SLIDE_DECEL. That collects to v^2 * (SLIP_DECAY - SLIDE_DECEL/2)
  // / SLIP_DECAY^2 — written out, v^2 * 588/686^2.
  const slide =
    (speed * speed * (SLIP_DECAY - SLIDE_DECEL / 2)) / (SLIP_DECAY * SLIP_DECAY);
  const rolling = (5 / 7) * speed;
  const roll = (rolling * rolling) / (2 * ROLL_DECEL);
  return slide + roll;
}

/**
 * The same for a ball that is **already rolling** at `speed` — no slide phase,
 * so no quick loss of 2/7 up front.
 *
 * Worth having separately because it is 1.86x further than `freeRunDistance`
 * at the same speed, and that is exactly the error a single "travel budget"
 * constant makes every time a ball comes off a cushion or is struck on.
 */
export function rollingRunDistance(speed: number): number {
  return (speed * speed) / (2 * ROLL_DECEL);
}

/**
 * The share of a struck ball's whole run that it spends still sliding — 5.06%,
 * the same at every speed, because both phases go as v^2.
 *
 * Small as a fraction, large in absolute terms where it matters: at full power
 * that is 987 cm, nearly four table lengths, so a hard shot is **still sliding**
 * when it reaches the object ball and the game's own 90-degree guideline is the
 * right answer. Only soft shots have rolled by then.
 */
export function slideFractionOfRun(): number {
  const slide = (SLIP_DECAY - SLIDE_DECEL / 2) / (SLIP_DECAY * SLIP_DECAY);
  return slide / freeRunDistance(1);
}

/**
 * Full-power free run as a multiple of the table's width — 76.8 lengths on the
 * strongest cue. Handy for sizing a travel budget in pixels without leaving
 * this file's units: `fullPowerTravelPx = tableWidthPx * fullPowerTravelWidths()`.
 */
export function fullPowerTravelWidths(cuePower = DEFAULT_CUE_POWER): number {
  return freeRunDistance(launchSpeed(1, cuePower)) / TABLE_WIDTH_CM;
}
