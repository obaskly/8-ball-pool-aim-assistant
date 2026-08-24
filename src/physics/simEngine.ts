/**
 * Runs a shot through the game's own simulation and reports it in the shape the
 * overlay already speaks.
 *
 * Three things happen here, in order:
 *
 *  1. **Correct the aim from what vision measured.** The one measurement worth
 *     more than our own geometry is the contact circle the game draws, because
 *     it is read where it matters instead of being our aim extended over the
 *     whole shot. See `ShotInput.contactPoint`.
 *  2. **Simulate**, in the game's centimetres, with the game's constants.
 *  3. **Convert back to pixels** and assemble the tree the renderer walks.
 *
 * The conversion in and out is where the table's true proportions get imposed.
 * We scale by the measured *width* alone and let the height follow from the
 * game's exact 2:1, rather than believing both of our own measurements — see
 * `mappingFor`.
 */

import { DEFAULT_CUE_POWER, launchSpeed } from './gamePhysics';
import {
  POCKET_KINDS,
  mappingFor,
  toScreen,
  toSim,
  type SimPoint,
  type TableMapping,
} from './table8bp';
import {
  DEFAULT_SIM_OPTIONS,
  simulate,
  type SimBall,
  type SimBallHit,
} from './sim';
import type {
  BallContact,
  CushionContact,
  EngineOptions,
  PathNode,
  PathSegment,
  PocketContact,
  Prediction,
  SegmentRole,
  ShotInput,
  TerminationReason,
  World,
} from './types';
import { dist, len, normalize, scale, sub, type Vec2 } from './vec2';

/** Screen-space direction into simulation space, which has y the other way. */
const dirToSim = (v: Vec2): SimPoint => ({ x: v.x, y: -v.y });
const dirToScreen = (v: SimPoint): Vec2 => ({ x: v.x, y: -v.y });

function emptyNode(ballId: string): PathNode {
  return {
    ballId,
    segments: [],
    cushions: [],
    impacts: [],
    termination: 'stopped',
    depth: 0,
    children: [],
  };
}

/**
 * Re-point the aim at the contact circle the game drew, when that circle really
 * does describe this shot.
 *
 * The test is that some ball sits one diameter from it — which is what a ghost
 * ball is, by construction — and that the circle is ahead of the cue ball. Both
 * are cheap and hard to pass by accident.
 */
function aimAtMeasuredContact(
  world: World,
  cuePos: Vec2,
  dir: Vec2,
  shot: ShotInput,
  opts: EngineOptions
): Vec2 {
  const measured = shot.contactPoint;
  if (!measured) return dir;
  const radius = world.table.ballRadius;

  let matched = false;
  for (const b of world.balls) {
    if (b.position === cuePos) continue;
    if (Math.abs(dist(measured, b.position) - 2 * radius) <= opts.contactSeparationRadii * radius) {
      matched = true;
      break;
    }
  }
  if (!matched) return dir;

  const travel = sub(measured, cuePos);
  const moved = len(travel);
  if (moved <= 1e-6) return dir;
  const corrected = scale(travel, 1 / moved);
  // Only a correction, not a new shot: refuse anything pointing backwards.
  if (corrected.x * dir.x + corrected.y * dir.y <= 0) return dir;
  return corrected;
}

function toContact(
  hit: SimBallHit,
  m: TableMapping,
  cuePower: number
): BallContact {
  const norm = (v: number) => v / cuePower;
  return {
    targetId: hit.targetId,
    sourceId: hit.sourceId,
    ghostBall: toScreen(hit.ghost, m),
    impactNormal: dirToScreen(hit.normal),
    cutAngle: hit.cutAngle,
    targetDirection: dirToScreen(hit.targetDir),
    tangentDirection: dirToScreen(hit.tangentDir),
    targetSpeed: norm(hit.targetSpeed),
    tangentSpeed: norm(hit.tangentSpeed),
    rollFraction: hit.rollFraction,
    // Where it sets off. Past this the path curves, and the segments carry that
    // rather than any single direction standing in for it.
    departDirection: dirToScreen(hit.tangentDir),
    departSpeed: norm(hit.tangentSpeed),
  };
}

export function predictShotSimulated(
  world: World,
  shot: ShotInput,
  opts: EngineOptions,
  cuePower = DEFAULT_CUE_POWER
): Prediction {
  const { balls, table } = world;
  const cue =
    (shot.cueBallId
      ? balls.find((b) => b.id === shot.cueBallId)
      : balls.find((b) => b.kind === 'cue')) ?? balls[0];

  if (!cue) {
    const empty = emptyNode('none');
    return { root: empty, segments: [], ballContacts: [], cushionContacts: [], potted: [] };
  }

  const m = mappingFor(table.playfield);
  let dir = normalize(shot.direction);
  if (dir.x === 0 && dir.y === 0) {
    const stalled = emptyNode(cue.id);
    return { root: stalled, segments: [], ballContacts: [], cushionContacts: [], potted: [] };
  }
  dir = aimAtMeasuredContact(world, cue.position, dir, shot, opts);

  // Cue ball first: the simulation gives it index 0 by convention.
  const ordered = [cue, ...balls.filter((b) => b !== cue)];
  const simBalls: SimBall[] = ordered.map((b) => ({
    id: b.id,
    position: toSim(b.position, m),
    velocity: { x: 0, y: 0 },
    spin: { x: 0, y: 0, z: 0 },
    onTable: true,
    pocketIndex: null,
    path: [],
    speeds: [],
    firstImpactAt: null,
    struckBy: null,
    pinned: 0,
  }));

  const speed = launchSpeed(shot.power, cuePower);
  const sd = dirToSim(dir);
  simBalls[0].velocity = { x: sd.x * speed, y: sd.y * speed };
  // Spin stays zero: struck through the centre, which is what the game does
  // when the spin selector sits in the middle. The ball spins itself up on the
  // cloth from there.

  const result = simulate(simBalls, {
    ...DEFAULT_SIM_OPTIONS,
    maxCushions: opts.maxCushions,
    budgetMs: opts.simBudgetMs,
  });

  return assemble(result, simBalls, m, opts, cuePower, world);
}

/** Nearest thing in `items` to `p`, by centre. Used to name what we just hit. */
function nearestId<T extends { id: string }>(
  items: readonly T[],
  centre: (t: T) => Vec2,
  p: Vec2,
  fallback: string
): string {
  let best = fallback;
  let bestD = Infinity;
  for (const it of items) {
    const c = centre(it);
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = it.id;
    }
  }
  return best;
}

function assemble(
  result: ReturnType<typeof simulate>,
  simBalls: SimBall[],
  m: TableMapping,
  opts: EngineOptions,
  cuePower: number,
  world: World
): Prediction {
  const byId = new Map(simBalls.map((b) => [b.id, b]));
  const cueId = simBalls[0].id;

  const hitsBySource = new Map<string, SimBallHit[]>();
  for (const h of result.hits) {
    const list = hitsBySource.get(h.sourceId) ?? [];
    list.push(h);
    hitsBySource.set(h.sourceId, list);
  }

  const cushionsByBall = new Map<string, CushionContact[]>();
  for (const c of result.cushions) {
    const list = cushionsByBall.get(c.ballId) ?? [];
    const at = toScreen(c.at, m);
    list.push({
      // Name it the way the caller's own table does, so downstream code that
      // knows about 'top' or 'left' keeps working.
      railId: nearestId(
        world.table.rails,
        (r) => ({ x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 }),
        at,
        c.kind === 'line' ? 'cushion' : 'jaw'
      ),
      at,
      incoming: dirToScreen(c.incoming),
      outgoing: dirToScreen(c.outgoing),
      // The game damps the normal and rubs the tangent, so these genuinely
      // differ — reporting one for both would be a fiction.
      incidentAngle: Math.atan2(c.incoming.y, c.incoming.x),
      reflectionAngle: Math.atan2(c.outgoing.y, c.outgoing.x),
      speedIn: c.speedIn / cuePower,
      speedOut: c.speedOut / cuePower,
    });
    cushionsByBall.set(c.ballId, list);
  }

  const potsByBall = new Map<string, PocketContact>();
  for (const p of result.pots) {
    const at = toScreen(p.at, m);
    potsByBall.set(p.ballId, {
      pocketId: nearestId(
        world.table.pockets,
        (q) => q.center,
        at,
        `${POCKET_KINDS[p.pocketIndex]}-${p.pocketIndex}`
      ),
      ballId: p.ballId,
      at,
    });
  }

  const childIds = new Map<string, string[]>();
  for (const b of simBalls) {
    if (b.struckBy && b.id !== cueId) {
      const list = childIds.get(b.struckBy) ?? [];
      list.push(b.id);
      childIds.set(b.struckBy, list);
    }
  }

  const allSegments: PathSegment[] = [];
  const allContacts: BallContact[] = [];
  const allCushions: CushionContact[] = [];
  const allPotted: PocketContact[] = [];

  const build = (id: string, depth: number): PathNode => {
    const b = byId.get(id)!;
    const node = emptyNode(id);
    node.depth = depth;

    const isCue = id === cueId;
    for (let i = 0; i + 1 < b.path.length; i++) {
      const from = toScreen(b.path[i], m);
      const to = toScreen(b.path[i + 1], m);
      const role: SegmentRole = !isCue
        ? 'object'
        : b.firstImpactAt !== null && i >= b.firstImpactAt
          ? 'tangent'
          : 'primary';
      const seg: PathSegment = {
        ballId: id,
        from,
        to,
        role,
        cushionIndex: 0,
        speedIn: (b.speeds[i] ?? 0) / cuePower,
        length: Math.hypot(to.x - from.x, to.y - from.y),
      };
      if (seg.length > 1e-9) {
        node.segments.push(seg);
        allSegments.push(seg);
      }
    }

    for (const h of hitsBySource.get(id) ?? []) {
      const contact = toContact(h, m, cuePower);
      node.impacts.push(contact);
      allContacts.push(contact);
    }
    if (node.impacts.length > 0) node.impact = node.impacts[0];

    const cs = cushionsByBall.get(id) ?? [];
    node.cushions = cs;
    allCushions.push(...cs);

    const pot = potsByBall.get(id);
    if (pot) {
      node.potted = pot;
      allPotted.push(pot);
    }

    node.termination = terminationFor(b, pot !== undefined, cs.length, opts, node);

    if (depth < opts.maxDepth) {
      for (const kid of childIds.get(id) ?? []) {
        node.children.push(build(kid, depth + 1));
      }
    }
    return node;
  };

  const root = build(cueId, 0);
  return {
    root,
    segments: allSegments,
    ballContacts: allContacts,
    cushionContacts: allCushions,
    potted: allPotted,
    primaryContact: root.impact,
  };
}

function terminationFor(
  b: SimBall,
  potted: boolean,
  cushions: number,
  opts: EngineOptions,
  node: PathNode
): TerminationReason {
  if (potted) return 'potted';
  // A full hit while still sliding hands over everything it had and the striker
  // stops dead. A *rolling* ball also leaves a full hit at zero speed, but the
  // spin it kept then drags it forward again — so the test is whether it
  // actually went anywhere afterwards, not what its velocity was at the instant.
  const last = node.impacts[node.impacts.length - 1];
  if (last && last.tangentSpeed < 1e-6 && b.firstImpactAt !== null) {
    let after = 0;
    for (let i = b.firstImpactAt; i + 1 < b.path.length; i++) {
      after += Math.hypot(
        b.path[i + 1].x - b.path[i].x,
        b.path[i + 1].y - b.path[i].y
      );
    }
    if (after < 0.5) return 'absorbed';
  }
  if (cushions >= opts.maxCushions && opts.maxCushions > 0) return 'max-cushions';
  return 'stopped';
}
