import { Vec2, add, dist, dot, len, normalize, scale, sub } from './vec2';
import {
  DEFAULT_ENGINE_OPTIONS,
  type Ball,
  type BallContact,
  type CushionContact,
  type EngineOptions,
  type PathNode,
  type PathSegment,
  type PocketContact,
  type Prediction,
  type SegmentRole,
  type ShotInput,
  type TerminationReason,
  type World,
} from './types';
import { STUN_EPSILON, resolveBallImpact } from './collision';
import { fullPowerTravelWidths, launchFraction } from './gamePhysics';
import { predictShotSimulated } from './simEngine';
import { reflectOffCushion } from './cushion';
import { EPS, SURFACE_EPS, castCircle, castPocket, castRail } from './geometry';

type EventKind = 'ball' | 'rail' | 'pocket';

interface PendingEvent {
  kind: EventKind;
  distance: number;
  ballIndex: number;
  railIndex: number;
  pocketIndex: number;
}

/**
 * Predict where every ball goes for a given shot.
 *
 * Model and its limits, stated plainly:
 *  - Equal-mass, perfectly elastic impacts. No english and no draw: a ball is
 *    assumed struck through its centre. Follow *is* modelled — a ball leaves the
 *    cue sliding, the cloth spins it up as it travels, and whatever roll it has
 *    by the time it arrives carries it forward off the tangent afterwards. See
 *    `EngineOptions.cueBallSpin`.
 *  - Balls are resolved against the *static* layout, with one correction: once a
 *    ball has been struck it is removed from the obstacle set, because it is no
 *    longer sitting where it was. Without this a ball can rebound off a cushion
 *    and collide with a ball that has already left.
 *  - Each path is resolved to completion before the balls it set in motion are
 *    traced, so a ball never collides with something knocked aside later in the
 *    chain. Genuinely simultaneous motion is approximated, not simulated.
 *  - Rolling resistance is modelled as a fixed distance budget proportional to
 *    kinetic energy: a ball at normalised speed v travels v^2 * fullPowerTravel
 *    before stopping.
 *
 * That is the standard set of assumptions behind a trajectory overlay, and it is
 * accurate for the first impact and the departure lines, which is what dominates.
 */
/**
 * `EngineOptions` with `fullPowerTravel` already turned into pixels, which is
 * all the internals ever want. Resolving it once at the top means nothing
 * downstream has to know the table's size.
 */
type ResolvedOptions = Omit<EngineOptions, 'fullPowerTravel'> & {
  fullPowerTravel: number;
};

/**
 * Full-power travel for this table, in pixels.
 *
 * The game's full-power shot runs 76.8 table lengths, so the only sane way to
 * express it is as a multiple of the table we are actually looking at. The old
 * fixed 6000 px was a number measured on one device and wrong on every other.
 */
function autoTravel(table: World['table']): number {
  const width = table.playfield.right - table.playfield.left;
  return width * fullPowerTravelWidths();
}

/**
 * Predict a shot the way the game itself would.
 *
 * This steps 8 Ball Pool's own physics rather than solving our approximation of
 * it — see `./sim`. The analytic walk it replaced is still here as
 * `predictShotAnalytic`, because it is the only way to get a straight-segment
 * answer without stepping, and it is useful to be able to compare the two.
 */
export function predictShot(
  world: World,
  shot: ShotInput,
  options?: Partial<EngineOptions>
): Prediction {
  const merged: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...options };
  return predictShotSimulated(world, shot, merged);
}

/**
 * The earlier analytic engine: straight segments, one departure angle per
 * impact, one travel budget per ball. Superseded by `predictShot` because it
 * cannot express a curving cue ball or balls moving at the same time, but kept
 * for comparison.
 */
export function predictShotAnalytic(
  world: World,
  shot: ShotInput,
  options?: Partial<EngineOptions>
): Prediction {
  const merged: EngineOptions = { ...DEFAULT_ENGINE_OPTIONS, ...options };
  const opts: ResolvedOptions = {
    ...merged,
    fullPowerTravel:
      merged.fullPowerTravel === 'auto'
        ? autoTravel(world.table)
        : merged.fullPowerTravel,
  };
  const { balls, table } = world;

  const cueBall =
    (shot.cueBallId
      ? balls.find((b) => b.id === shot.cueBallId)
      : balls.find((b) => b.kind === 'cue')) ?? balls[0];

  if (!cueBall) {
    const empty: PathNode = {
      ballId: 'none',
      segments: [],
      cushions: [],
      impacts: [],
      termination: 'stopped',
      depth: 0,
      children: [],
    };
    return {
      root: empty,
      segments: [],
      ballContacts: [],
      cushionContacts: [],
      potted: [],
    };
  }

  const direction = normalize(shot.direction);
  // The meter is not linear in speed. The game runs it through 1 - sqrt(1 - p)
  // before it ever becomes a velocity, which is strongly convex: half a meter
  // of pull is 29% of full speed, not 50%. Feeding the raw fraction in here is
  // what made every soft shot's path up to 3.8x too long.
  const power = launchFraction(shot.power);

  // Balls already in motion are not obstacles. The cue ball is moving from t=0.
  const moved = new Set<string>([cueBall.id]);

  const root =
    direction.x === 0 && direction.y === 0
      ? {
          ballId: cueBall.id,
          segments: [],
          cushions: [],
          impacts: [],
          termination: 'stopped' as TerminationReason,
          depth: 0,
          children: [],
        }
      : walk(
          world,
          opts,
          {
            ballId: cueBall.id,
            origin: cueBall.position,
            direction,
            speed: power,
            role: 'primary',
            depth: 0,
            firstContact: shot.firstContact,
            contactPoint: shot.contactPoint,
          },
          moved
        );

  return flatten(root);
}

interface WalkParams {
  ballId: string;
  origin: Vec2;
  direction: Vec2;
  speed: number;
  role: SegmentRole;
  depth: number;
  /** See `ShotInput.firstContact`. Applies to this path's first event only. */
  firstContact?: number;
  contactPoint?: Vec2;
}

/**
 * How much of a natural roll a ball has picked up after running `run`, having
 * been set moving at normalised speed `speed`.
 *
 * A ball struck through its centre leaves sliding, with no spin at all. The
 * cloth drags on the bottom of it, which slows it and spins it up at the same
 * time, until the surface stops slipping and it rolls. Writing `tau` for how far
 * through that spin-up it is, the speed has fallen by `tau` and the spin has
 * risen by 5/2 of it, so
 *
 *   rollFraction = (5/2) * tau / (1 - tau)
 *
 * and the distance covered getting there is `(tau - tau^2/2)` in units of the
 * full slide. Rolling starts at tau = 2/7, having covered 12/49 of that unit,
 * which inverts to the closed form below. No iteration needed.
 */
function rollFractionAfter(
  run: number,
  speed: number,
  opts: ResolvedOptions,
  settled: boolean,
): number {
  if (opts.cueBallSpin === 'stun') return 0;
  if (opts.cueBallSpin === 'natural' || settled) return 1;
  // Slide distance grows with the square of speed, which is why a hard short
  // shot can still arrive stunned while a soft long one always rolls.
  const slide = opts.slideDistanceRatio * opts.fullPowerTravel * speed * speed;
  if (slide <= EPS) return 1;
  const done = Math.min(1, Math.max(0, run / slide));
  const tau = 1 - Math.sqrt(Math.max(0, 1 - (24 / 49) * done));
  if (tau >= 2 / 7) return 1;
  return Math.min(1, (2.5 * tau) / Math.max(EPS, 1 - tau));
}

/**
 * Move the impact onto the contact point the game drew, when that circle really
 * does describe this collision.
 *
 * Two things have to hold. The circle has to sit near the contact we found on our
 * own, or it belongs to something else on screen; and the ball being struck has to
 * sit one diameter from it, which is what a ghost ball is. Anything else and we
 * keep our own answer.
 *
 * On acceptance the travel direction is re-pointed at the measured contact as
 * well. The cue ball did travel in a straight line to wherever it actually
 * struck, so if the circle is right then our aim was the thing that was slightly
 * wrong, and the corrected direction has the whole length of the shot behind it
 * rather than a Hough bin.
 */
function snapToMeasuredContact(
  world: World,
  pos: Vec2,
  dir: Vec2,
  ballIndex: number,
  castHit: Vec2,
  measured: Vec2,
  opts: ResolvedOptions,
): { dir: Vec2; hitPoint: Vec2; distance: number } | null {
  const radius = world.table.ballRadius;
  if (dist(measured, castHit) > opts.contactTrustRadii * radius) return null;

  const target = world.balls[ballIndex];
  if (!target) return null;
  const gap = Math.abs(dist(measured, target.position) - 2 * radius);
  if (gap > opts.contactSeparationRadii * radius) return null;

  const travel = sub(measured, pos);
  const moved = len(travel);
  if (moved <= EPS || dot(travel, dir) <= 0) return null;
  return { dir: scale(travel, 1 / moved), hitPoint: measured, distance: moved };
}

function walk(
  world: World,
  opts: ResolvedOptions,
  params: WalkParams,
  moved: Set<string>
): PathNode {
  const { table, balls } = world;
  const { fullPowerTravel: K } = opts;
  const budgetFor = (v: number) => v * v * K;
  const speedFor = (budget: number) => Math.sqrt(Math.max(0, budget) / K);

  const self = balls.find((b) => b.id === params.ballId);
  const radius = self?.radius ?? table.ballRadius;

  const node: PathNode = {
    ballId: params.ballId,
    segments: [],
    cushions: [],
    impacts: [],
    termination: 'stopped',
    depth: params.depth,
    children: [],
  };

  let pos = params.origin;
  let dir = params.direction;
  let budget = budgetFor(params.speed);
  let role = params.role;
  let cushionIndex = 0;
  // How far this ball has run since it was set moving. A ball is struck sliding
  // and the cloth spins it up as it goes, so distance is what decides whether it
  // arrives stunned or rolling.
  let run = 0;
  // Set once the ball is known to be rolling regardless of how far it has come:
  // after an impact, because the departure speed is the settled one, and after a
  // cushion, by which point it has run the length of the table and back.
  let settled = false;

  // Balls this path sets in motion. Traced only once this path is complete.
  const pending: WalkParams[] = [];
  let termination: TerminationReason = 'max-events';

  // The measurement describes where the *first* obstruction is. Everything after
  // it is ours to work out, and everything after a cushion is past the end of
  // the line the game drew, so the hint is spent on the first cast and dropped.
  let hint = params.firstContact;
  let measured = params.contactPoint;

  for (let step = 0; step < opts.maxEventsPerPath; step++) {
    const speedIn = speedFor(budget);
    if (speedIn < opts.minSpeed) {
      termination = 'stopped';
      break;
    }

    const event = nextEvent(world, pos, dir, radius, moved, opts, hint);
    hint = undefined;

    // Nothing in the way, or the ball runs out of energy first.
    if (!event || event.distance > budget) {
      pushSegment(node, params.ballId, pos, add(pos, scale(dir, budget)), role, cushionIndex, speedIn);
      termination = 'stopped';
      break;
    }

    let hitPoint = add(pos, scale(dir, event.distance));
    let travelled = event.distance;
    if (measured !== undefined && event.kind === 'ball') {
      const snapped = snapToMeasuredContact(
        world, pos, dir, event.ballIndex, hitPoint, measured, opts,
      );
      if (snapped) {
        dir = snapped.dir;
        hitPoint = snapped.hitPoint;
        travelled = snapped.distance;
      }
    }
    // Spent on the first event, like the reach measurement: it describes the
    // shot as struck, not whatever the cue ball goes on to do afterwards.
    measured = undefined;

    pushSegment(node, params.ballId, pos, hitPoint, role, cushionIndex, speedIn);
    budget -= travelled;
    run += travelled;
    const speedAtEvent = speedFor(budget);
    pos = hitPoint;

    if (event.kind === 'pocket') {
      const pocket = table.pockets[event.pocketIndex];
      node.potted = { pocketId: pocket.id, ballId: params.ballId, at: hitPoint };
      termination = 'potted';
      break;
    }

    if (event.kind === 'rail') {
      if (cushionIndex >= opts.maxCushions) {
        termination = 'max-cushions';
        break;
      }
      const rail = table.rails[event.railIndex];
      const r = reflectOffCushion(
        dir,
        speedAtEvent,
        rail.normal,
        opts.restitution,
        opts.preserveReflectionAngle
      );
      node.cushions.push({
        railId: rail.id,
        at: hitPoint,
        incoming: dir,
        outgoing: r.direction,
        incidentAngle: r.incidentAngle,
        reflectionAngle: r.reflectionAngle,
        speedIn: speedAtEvent,
        speedOut: r.speed,
      });

      dir = r.direction;
      budget = budgetFor(r.speed);
      settled = true;
      cushionIndex++;
      pos = add(pos, scale(dir, SURFACE_EPS));
      continue;
    }

    // Ball-to-ball impact.
    const target = balls[event.ballIndex];
    const contact = resolveBallImpact(
      params.ballId,
      target.id,
      hitPoint,
      target.position,
      dir,
      speedAtEvent,
      rollFractionAfter(run, params.speed, opts, settled)
    );
    node.impacts.push(contact);
    // Keep the first: that is the one the cut angle and ghost ball describe. A
    // rolling cue ball can go on to hit more, but those are not what is aimed.
    if (node.impact === undefined) node.impact = contact;
    // The struck ball leaves: it stops being an obstacle for everything downstream.
    moved.add(target.id);

    if (params.depth < opts.maxDepth && contact.targetSpeed > opts.minSpeed) {
      pending.push({
        ballId: target.id,
        origin: target.position,
        direction: contact.targetDirection,
        speed: contact.targetSpeed,
        role: 'object',
        depth: params.depth + 1,
      });
    }

    // A dead-straight hit leaves nothing tangential, and a ball that arrived
    // sliding has no roll to carry it on either, so it stops: the stun shot. One
    // that arrived rolling follows through instead.
    if (contact.departSpeed < STUN_EPSILON || contact.departSpeed < opts.minSpeed) {
      termination = 'absorbed';
      break;
    }

    // Following it down the same line: the struck ball is ahead and faster, so it
    // screens whatever is beyond and we have nothing honest to say past here.
    if (
      dot(contact.departDirection, contact.targetDirection) >
      Math.cos((opts.followScreenDegrees * Math.PI) / 180)
    ) {
      termination = 'screened';
      break;
    }

    dir = contact.departDirection;
    budget = budgetFor(contact.departSpeed);
    // That departure speed is by definition the one it settles at, so from here
    // on it is rolling.
    settled = true;
    role = role === 'object' ? 'object' : 'tangent';
    pos = add(pos, scale(dir, SURFACE_EPS));
  }

  node.termination = termination;
  for (const child of pending) {
    node.children.push(walk(world, opts, child, moved));
  }
  return node;
}

/**
 * The obstruction this ball meets first: another ball, a cushion, or a pocket.
 * Balls in `moved` are skipped: they are already travelling, so they are not
 * sitting at their recorded position any more.
 *
 * `hint` changes the question being asked. Without one, nearest wins, which is
 * the only answer available and is wrong whenever two candidates are close: the
 * cue ball's line passes within a whisker of balls it does not touch, and a
 * detected centre only has to be a pixel off for one of those to come out ahead
 * of the cushion the ball really reaches. With one — the length of the guideline
 * the game itself drew, which is the game telling us the answer it computed —
 * the candidate at that distance wins instead, whether or not it is nearest.
 *
 * A hint that matches nothing means the scene we detected cannot account for the
 * line on screen, so it is dropped and nearest wins again. That is no worse than
 * having taken no measurement, which matters: a frame that draws the old answer
 * is better than a frame that draws nothing.
 */
function nextEvent(
  world: World,
  origin: Vec2,
  dir: Vec2,
  radius: number,
  moved: Set<string>,
  opts: ResolvedOptions,
  hint?: number
): PendingEvent | null {
  const { table, balls } = world;
  const hinted = hint !== undefined && hint > 0;
  const tolerance = opts.firstContactRadii * table.ballRadius;
  const graze = hinted ? opts.grazeRadii * table.ballRadius : 0;

  let nearest: PendingEvent | null = null;
  let nearestDistance = Infinity;
  let matched: PendingEvent | null = null;
  let matchedOffset = Infinity;

  const consider = (
    kind: EventKind,
    distance: number | null,
    ballIndex = -1,
    railIndex = -1,
    pocketIndex = -1
  ) => {
    if (distance === null || distance < 0) return;

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = { kind, distance, ballIndex, railIndex, pocketIndex };
    }

    if (!hinted) return;
    const offset = Math.abs(distance - hint!);
    if (offset <= tolerance && offset < matchedOffset) {
      matchedOffset = offset;
      matched = { kind, distance, ballIndex, railIndex, pocketIndex };
    }
  };

  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (moved.has(b.id)) continue;
    consider(
      'ball',
      castCircle(origin, dir, b.position, radius, b.radius, graze),
      i
    );
  }

  for (let i = 0; i < table.pockets.length; i++) {
    consider('pocket', castPocket(origin, dir, table.pockets[i]), -1, -1, i);
  }

  for (let i = 0; i < table.rails.length; i++) {
    consider('rail', castRail(origin, dir, table.rails[i], radius), -1, i);
  }

  return matched ?? nearest;
}

function pushSegment(
  node: PathNode,
  ballId: string,
  from: Vec2,
  to: Vec2,
  role: SegmentRole,
  cushionIndex: number,
  speedIn: number
): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length <= EPS) return;
  node.segments.push({ ballId, from, to, role, cushionIndex, speedIn, length });
}

function flatten(root: PathNode): Prediction {
  const segments: PathSegment[] = [];
  const ballContacts: BallContact[] = [];
  const cushionContacts: CushionContact[] = [];
  const potted: PocketContact[] = [];

  const visit = (node: PathNode) => {
    segments.push(...node.segments);
    cushionContacts.push(...node.cushions);
    ballContacts.push(...node.impacts);
    if (node.potted) potted.push(node.potted);
    node.children.forEach(visit);
  };
  visit(root);

  return {
    root,
    segments,
    ballContacts,
    cushionContacts,
    potted,
    primaryContact: root.impact,
  };
}
