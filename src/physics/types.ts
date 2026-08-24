import { DEFAULT_CUE_POWER } from './gamePhysics';
import type { Vec2 } from './vec2';

export type BallKind = 'cue' | 'solid' | 'stripe' | 'eight' | 'unknown';

export interface Ball {
  id: string;
  position: Vec2;
  radius: number;
  kind: BallKind;
}

/**
 * A cushion. `a`/`b` are the endpoints of the cushion face; `normal` is the unit
 * vector pointing into the playfield. A ball centre can approach the face no
 * closer than one ball radius.
 */
export interface Rail {
  id: string;
  a: Vec2;
  b: Vec2;
  normal: Vec2;
}

export interface Pocket {
  id: string;
  center: Vec2;
  /** A ball whose centre comes within this distance of `center` is potted. */
  captureRadius: number;
  kind: 'corner' | 'side';
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TableGeometry {
  /** Cushion faces, in table units (screen pixels by default). */
  playfield: Rect;
  ballRadius: number;
  rails: Rail[];
  pockets: Pocket[];
}

export interface World {
  table: TableGeometry;
  balls: Ball[];
}

export interface ShotInput {
  /** Aim direction; need not be normalised. */
  direction: Vec2;
  /** Normalised shot power in [0, 1]. */
  power: number;
  /** Defaults to the ball with kind 'cue'. */
  cueBallId?: string;
  /**
   * Measured distance from the cue ball centre to the first obstruction, when
   * something outside the engine already knows it. Read off the length of the
   * game's own guideline; omitted for a manually aimed shot.
   *
   * With this the engine stops asking which obstruction is *nearest* and starts
   * asking which one is at the distance the guideline actually ends, which are
   * different questions whenever the answer is close. A ball the cue ball
   * merely passes by sits nearer than the cushion it will really reach, and no
   * amount of care with the cast can tell those apart — the game already did,
   * and this is how it says so.
   */
  firstContact?: number;
  /**
   * Measured centre of the ghost ball the game draws at the contact — where the
   * cue ball's centre will be at impact. Omitted when none was on screen.
   *
   * This is worth far more than it looks. The object ball leaves along the line
   * from the contact point to its own centre, and that line is only one ball
   * diameter long, so the departure direction divides every error in the contact
   * point by 2R: at a 16px radius one pixel is 1.8 degrees, and the contact point
   * we compute ourselves is the aim direction extended over the whole length of
   * the shot, which multiplies a fraction of a degree of aim error into several
   * pixels. A cushion rebound has no such lever on it — the reflection is as good
   * as the aim and no worse — which is exactly why cushion lines come out right
   * while object-ball lines drift.
   *
   * The drawn circle cuts the lever out: it is measured where it matters, with
   * the whole circumference behind it, and it does not depend on our aim fit, our
   * ball centres or our ball radius at all.
   */
  contactPoint?: Vec2;
}

export interface EngineOptions {
  /**
   * How many generations of struck balls to follow. 0 = cue ball only.
   *
   * One by default: the cue ball's own path and the balls it actually hits.
   * The generation after that is where the drawing stops being worth its ink —
   * every error in the aim, the ball centres and the radius has been through
   * two collisions by then, and what lands on screen is a scribble across the
   * whole table that happens to be drawn confidently. The slider goes to four
   * for anyone who wants to see it anyway.
   */
  maxDepth: number;
  /** Maximum cushion bounces per individual ball path. */
  maxCushions: number;
  /** Cushion restitution, 0..1. Spec value ~0.9. */
  restitution: number;
  /**
   * When true, a cushion bounce mirrors the direction exactly
   * (theta_incident === theta_reflection) and scales speed by `restitution`.
   * When false, only the normal component is damped, which is more physical
   * but makes the outgoing angle differ from the incoming one.
   */
  preserveReflectionAngle: boolean;
  /**
   * Distance a ball travels at power 1.0 before rolling to a stop.
   *
   * `'auto'` derives it from the table itself, which is the only way to get it
   * right: the game's full-power run is 76.8 table lengths (see
   * `fullPowerTravelWidths`), so the number depends on how many pixels wide the
   * table we are looking at happens to be. A fixed pixel count was wrong on
   * every device but the one it was measured on.
   */
  fullPowerTravel: number | 'auto';
  /** Paths below this speed are considered stopped. */
  minSpeed: number;
  /** Hard safety cap on events resolved per ball path. */
  maxEventsPerPath: number;
  /**
   * How far a candidate contact may sit from a measured `firstContact` and still
   * be accepted as the thing the guideline ended on, in ball radii.
   *
   * Sized from what the measurement is actually worth: over eleven test frames
   * the right obstruction was always within 1.9 radii of the drawn line's end,
   * and every wrong one was five radii out or more. Anything in that gap is a
   * safe place to cut.
   */
  firstContactRadii: number;
  /**
   * How far the cue ball may miss an object ball and still be treated as having
   * grazed it, in ball radii. Applies only while a `firstContact` measurement is
   * available to throw out the misses it lets through.
   */
  grazeRadii: number;
  /**
   * How far a measured `contactPoint` may sit from the contact our own cast found
   * before it stops being believable, in ball radii.
   *
   * Wide enough to be worth having — across the test frames the drawn circle sat
   * up to 0.4 radii from our cast, and correcting that was the whole point — but
   * not so wide that a circle belonging to something else can drag the impact
   * onto a different part of the table.
   */
  contactTrustRadii: number;
  /**
   * How far the struck ball's centre may be from exactly one diameter away from
   * the measured contact point, in ball radii, before the measurement is treated
   * as belonging to some other circle. A genuine ghost ball sits at a diameter by
   * construction, so this is a strong test and a cheap one.
   */
  contactSeparationRadii: number;
  /**
   * What the cue ball is assumed to be doing when it reaches the object ball,
   * which decides where it goes afterwards.
   *
   *  'stun'    — always sliding. Reproduces the 90-degree tangent the game draws
   *              on screen. Use this to match the in-game guideline exactly.
   *  'natural' — always rolling. The 30-degree-rule answer.
   *  'auto'    — worked out per shot from the power and how far the cue ball has
   *              to travel, which is what actually determines it.
   *
   * The game's own guideline is a stun line by construction — measured across
   * the test frames it draws its tangent at 90.3 degrees — but Miniclip's
   * documentation says that line is an approximation and the real path differs
   * once the cue ball is rolling. 'auto' predicts the ball; 'stun' predicts the
   * drawn line.
   */
  cueBallSpin: 'stun' | 'natural' | 'auto';
  /**
   * Cue speed at full power, cm/s — which cue the player has equipped.
   *
   * The game's cues run from 666 to 888.85, a 33% spread, and the meter is
   * read as a fraction of whichever one you hold. Assuming the strongest draws
   * every path far too long for anyone still on an early cue: speed enters the
   * free run squared, so a 666 cue reaches 44% less far than this predicts at
   * the same meter reading. PoolPredictor reads the tier straight out of the
   * game; we cannot, so it is asked for.
   */
  cuePower: number;
  /**
   * Wall-clock budget for one prediction's simulation, milliseconds. See
   * `SimOptions.budgetMs` — this is the lid that keeps a heavy table state from
   * wedging the UI thread. Paths past the budget are truncated, never wrong.
   */
  simBudgetMs: number;
  /**
   * How far a full-power ball slides before friction spins it up to a natural
   * roll, as a fraction of `fullPowerTravel`. Only consulted when `cueBallSpin`
   * is 'auto'.
   *
   * Sliding friction is roughly twenty times rolling friction, so the slide is
   * over quickly: a ball spends about the first 5% of its journey sliding and
   * the rest rolling. That is why most shots arrive rolling, and why the
   * 30-degree rule is the one players are taught. Slide distance grows with the
   * square of speed, so a hard short shot can still arrive stunned.
   */
  slideDistanceRatio: number;
  /**
   * When the striking ball departs within this many degrees of the ball it just
   * struck, it is treated as screened and its path ends. See the 'screened'
   * termination reason.
   *
   * Only near-full hits reach it: the two departure directions separate fast, so
   * by a 6-degree cut they are already 20 degrees apart. It exists because follow
   * makes dead-straight hits interesting again — before, the cue ball simply
   * stopped there and the question never arose.
   */
  followScreenDegrees: number;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  maxDepth: 1,
  maxCushions: 3,
  restitution: 0.9,
  preserveReflectionAngle: true,
  fullPowerTravel: 'auto',
  minSpeed: 0.02,
  maxEventsPerPath: 24,
  firstContactRadii: 2.2,
  grazeRadii: 0.55,
  contactTrustRadii: 1.6,
  contactSeparationRadii: 0.4,
  cueBallSpin: 'auto',
  cuePower: DEFAULT_CUE_POWER,
  simBudgetMs: 12,
  // Exactly (SLIP_DECAY - SLIDE_DECEL/2) / SLIP_DECAY^2 over the whole free
  // run — see `slideFractionOfRun` in ./gamePhysics. Both phases go as v^2, so
  // this is one number for every speed. The old 0.046 was a guess near it.
  slideDistanceRatio: 0.050583,
  followScreenDegrees: 20,
};

export type SegmentRole =
  /** Cue ball, before it has contacted any object ball. */
  | 'primary'
  /** Cue ball, after the tangent-line separation. */
  | 'tangent'
  /** A ball that was set in motion by an impact. */
  | 'object';

export interface PathSegment {
  ballId: string;
  from: Vec2;
  to: Vec2;
  role: SegmentRole;
  /** 0 before the first cushion of this path, 1 after it, and so on. */
  cushionIndex: number;
  /** Normalised speed entering this segment. */
  speedIn: number;
  length: number;
}

export type TerminationReason =
  | 'stopped'
  | 'potted'
  | 'max-cushions'
  | 'max-events'
  | 'absorbed'
  /**
   * The ball is following the one it just struck down nearly the same line. It
   * is slower than the ball ahead of it and can never get past, so that ball
   * screens whatever lies beyond. Paths are resolved one at a time here, which
   * cannot represent one ball trailing another, so the prediction stops rather
   * than pretend the way is clear.
   */
  | 'screened';

export interface BallContact {
  /** The ball that was struck. */
  targetId: string;
  /** The ball doing the striking. */
  sourceId: string;
  /** Centre position of the striking ball at the moment of contact. */
  ghostBall: Vec2;
  /** Unit vector along the line of centres, from ghost centre to target centre. */
  impactNormal: Vec2;
  /** Angle between the incoming direction and the line of centres, in radians. */
  cutAngle: number;
  /** Direction the struck ball departs along (=== impactNormal). */
  targetDirection: Vec2;
  /**
   * The bare 90-degree tangent, perpendicular to `impactNormal`. This is where
   * the striker sets off and what the game draws, but not where it ends up
   * unless it was sliding — see `departDirection`.
   */
  tangentDirection: Vec2;
  targetSpeed: number;
  tangentSpeed: number;
  /** How much of a natural roll the striking ball carried in, 0..1. */
  rollFraction: number;
  /**
   * Where the striking ball actually goes: the tangent bent forward by whatever
   * topspin survived the impact. Equal to `tangentDirection` when `rollFraction`
   * is 0, and up to 33 degrees off it on a rolling half-ball hit.
   */
  departDirection: Vec2;
  /** Speed of the striking ball once it has settled back into a roll. */
  departSpeed: number;
}

export interface CushionContact {
  railId: string;
  at: Vec2;
  incoming: Vec2;
  outgoing: Vec2;
  /** Angle to the cushion normal, in radians. Equal on both sides by construction. */
  incidentAngle: number;
  reflectionAngle: number;
  speedIn: number;
  speedOut: number;
}

export interface PocketContact {
  pocketId: string;
  ballId: string;
  at: Vec2;
}

/** One ball's path, plus the paths of everything it set in motion. */
export interface PathNode {
  ballId: string;
  segments: PathSegment[];
  cushions: CushionContact[];
  /**
   * The first ball this path struck. This is the aiming-relevant one: it is the
   * contact the cut angle and the ghost ball belong to.
   *
   * It no longer necessarily *ends* the path. A cue ball that arrives rolling
   * carries on through a full hit instead of stunning dead, so it can strike
   * several balls in a row — see `impacts` for the rest.
   */
  impact?: BallContact;
  /** Every ball this path struck, in the order it struck them. */
  impacts: BallContact[];
  potted?: PocketContact;
  termination: TerminationReason;
  depth: number;
  children: PathNode[];
}

export interface Prediction {
  root: PathNode;
  /** Every segment in the tree, flattened for renderers. */
  segments: PathSegment[];
  ballContacts: BallContact[];
  cushionContacts: CushionContact[];
  potted: PocketContact[];
  /** Contact data for the cue ball's first impact, if any. */
  primaryContact?: BallContact;
}
