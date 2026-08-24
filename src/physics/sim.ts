/**
 * 8 Ball Pool's shot simulation, ported.
 *
 * This is a transcription of PoolPredictor's `Prediction.cpp` — itself a
 * reimplementation of the game's decompiled physics — rather than a model of
 * our own. Everything it does, the game does.
 *
 * The shape of it matters as much as the constants. It is a **fixed 200 Hz step
 * with continuous collision detection inside each step**: every tick it asks
 * every moving ball when its next collision would be, shortens the step to the
 * earliest of them, advances *all* balls together, resolves that one collision,
 * and repeats until the tick is used up. Then friction is applied once per tick.
 *
 * Two things fall out of that which our analytic walk could never express:
 *
 *  - **Balls move simultaneously.** Resolving one path to completion before
 *    tracing what it hit means a ball can be struck by something that, in real
 *    time, would not have arrived yet. Stepping removes the question.
 *  - **Paths curve.** A ball carries spin that friction is still working on, so
 *    after a collision its velocity and its spin disagree and the cloth bends it
 *    round. That is the follow you see after a cue ball hits an object ball, and
 *    it is up to 45 degrees over the first metre. No single departure angle can
 *    stand in for it.
 */

import {
  BALL_RADIUS_CM,
  CUSHION_FRICTION,
  CUSHION_RESTITUTION,
  CUSHION_SPIN_GAIN,
  ENGLISH_DECAY,
  POCKET_PULL,
  POCKET_RADIUS_CM,
  ROLL_DECEL,
  SLIDE_DECEL,
  SLIP_DECAY,
  TICK_SECONDS,
} from './gamePhysics';
import { POCKETS_CM, TABLE_SHAPE_CM, type SimPoint } from './table8bp';

/** The game's own epsilon for "no time left in this step". */
const MIN_TIME = 1e-11;

/** Broad-phase bound: a ball centre can never pass these. */
const BOUND_X = 127 - BALL_RADIUS_CM;
const BOUND_Y = 63.5 - BALL_RADIUS_CM;

const R2 = BALL_RADIUS_CM * BALL_RADIUS_CM;
const POCKET_R2 = POCKET_RADIUS_CM * POCKET_RADIUS_CM;

/**
 * How far a stored point may sit off the straight line between its neighbours
 * before it is worth keeping, in cm. Straight runs collapse to two points;
 * curves keep the detail that makes them curves.
 *
 * 0.01 cm is deliberately tight — about a sixteenth of a pixel. The cue ball
 * bends hardest in the first few ticks after a contact, and at a looser 0.05 cm
 * the very first drawn segment averaged across that and came out 24 degrees off
 * the tangent the ball actually leaves on, which is the one part of the curve
 * the player is looking at.
 */
const PATH_TOLERANCE_CM = 0.01;

export interface SimBall {
  id: string;
  position: SimPoint;
  velocity: SimPoint;
  spin: { x: number; y: number; z: number };
  onTable: boolean;
  /** Set once the ball has dropped; index into POCKETS_CM. */
  pocketIndex: number | null;
  /** Recorded polyline, cm. */
  path: SimPoint[];
  /** Speed, cm/s, at each recorded point. Parallel to `path`. */
  speeds: number[];
  /** Index in `path` where this ball's first impact happened, if any. */
  firstImpactAt: number | null;
  /** Who struck this ball into motion, if anyone. */
  struckBy: string | null;
  /** Whether the measured first-bounce override has been spent on this ball. */
  consumedBounce?: boolean;
  /**
   * How many leading path points are fixed. Points recorded at an event anchor
   * the polyline — an impact or a bounce happened exactly there — so the
   * straight-run simplification below must never slide one forward.
   */
  pinned: number;
}

export interface SimBallHit {
  sourceId: string;
  targetId: string;
  /** Striker's centre at contact — the ghost ball. */
  ghost: SimPoint;
  targetCentre: SimPoint;
  /** Unit vector along the line of centres, ghost -> target. */
  normal: SimPoint;
  incoming: SimPoint;
  speedIn: number;
  cutAngle: number;
  targetDir: SimPoint;
  targetSpeed: number;
  tangentDir: SimPoint;
  tangentSpeed: number;
  /**
   * How rolled the striker was on arrival, 0..1. A ball is rolling when its
   * spin matches its speed, so this is |spin_xy| * R / |v| just before impact.
   */
  rollFraction: number;
}

export interface SimCushionHit {
  ballId: string;
  at: SimPoint;
  incoming: SimPoint;
  outgoing: SimPoint;
  speedIn: number;
  speedOut: number;
  kind: 'line' | 'point';
}

export interface SimPot {
  ballId: string;
  pocketIndex: number;
  at: SimPoint;
}

export interface SimOptions {
  /**
   * Hard cap on ticks. At 200 Hz a full-power break can ring around for tens of
   * seconds of game time, which is neither drawable nor worth computing; this
   * bounds the work per frame.
   */
  maxTicks: number;
  /** Stop once every ball is below this speed, cm/s. */
  restSpeed: number;
  /** Stop recording a ball's path after this many cushion contacts. */
  maxCushions: number;
  /**
   * Measured override for the cue ball's first cushion rebound, in sim space:
   * where the game says the bounce happens and the unit direction it leaves in.
   * Applied once, to the first cushion the cue ball takes within `tolerance` cm
   * of the point; speed and spin still come from the physics.
   */
  measuredBounce: { x: number; y: number; dx: number; dy: number; tolerance: number } | null;
  /**
   * Wall-clock budget for one simulation, in milliseconds.
   *
   * This is the guarantee the tick cap cannot give. The stepper runs on the JS
   * thread, the phone runs it interpreted, and the cost of a tick is not a
   * constant: a break shot pushes fifteen balls through chained collisions and
   * costs hundreds of times a quiet roll. The one session-killing failure this
   * code has had was exactly that — predictions that each took long enough that
   * the UI thread never drained, so the overlay froze on a stale scene, the
   * Stop button stopped answering, and the app had to be killed against a
   * capture service it could no longer stop. A prediction that overruns is
   * truncated: the near part of every path — the part that is accurate anyway —
   * is kept, and the far tails are dropped.
   */
  budgetMs: number;
}

export const DEFAULT_SIM_OPTIONS: SimOptions = {
  maxTicks: 2400,
  restSpeed: 1.0,
  maxCushions: 4,
  budgetMs: 12,
  measuredBounce: null,
};

/**
 * Substeps allowed inside one tick before the remainder of the tick is
 * abandoned.
 *
 * The substep loop runs until the tick's time is consumed, and each collision
 * consumes only the time it took to reach it. A ball wedged in a pocket jaw —
 * suction pushing it into the cushion, the cushion reflecting it back out — can
 * produce collisions at zero time forever, and `remaining` then never shrinks:
 * an infinite loop on the UI thread, which is indistinguishable from the app
 * dying. Real play never chains this many collisions in five milliseconds; a
 * rack break peaks well under half of it.
 */
const MAX_SUBSTEPS_PER_TICK = 40;

export interface SimResult {
  balls: SimBall[];
  hits: SimBallHit[];
  cushions: SimCushionHit[];
  pots: SimPot[];
  ticks: number;
}

const isMoving = (b: SimBall) =>
  b.velocity.x !== 0 ||
  b.velocity.y !== 0 ||
  b.spin.x !== 0 ||
  b.spin.y !== 0 ||
  b.spin.z !== 0;

/** Append to a ball's path, dropping points that only restate a straight run. */
function record(ball: SimBall, force = false): void {
  const p = ball.position;
  const sp = Math.hypot(ball.velocity.x, ball.velocity.y);
  const n = ball.path.length;
  if (n === 0) {
    ball.path.push({ x: p.x, y: p.y });
    ball.speeds.push(sp);
    if (force) ball.pinned = ball.path.length;
    return;
  }
  const last = ball.path[n - 1];
  if (last.x === p.x && last.y === p.y) {
    ball.speeds[n - 1] = sp;
    if (force) ball.pinned = n;
    return;
  }
  if (!force && n >= 2 && n - 1 >= ball.pinned) {
    const a = ball.path[n - 2];
    // Perpendicular distance from `last` to the line a -> p.
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const span = Math.hypot(dx, dy);
    if (span > 0) {
      const cross = Math.abs(dx * (last.y - a.y) - dy * (last.x - a.x)) / span;
      if (cross < PATH_TOLERANCE_CM) {
        // `last` adds nothing: slide it forward instead of growing the path.
        last.x = p.x;
        last.y = p.y;
        ball.speeds[n - 1] = sp;
        return;
      }
    }
  }
  ball.path.push({ x: p.x, y: p.y });
  ball.speeds.push(sp);
  if (force) ball.pinned = ball.path.length;
}

/**
 * `Prediction::Ball::calcVelocity` — one tick of cloth friction.
 *
 * The ball's contact patch is slipping at `v + omega x (-R z)`. While that slip
 * survives, sliding friction pulls the ball's velocity along it at 196 cm/s^2
 * and spins the ball up at 5/2 of that over R, so the slip itself dies at
 * 686 = 7/2 x 196. Once it reaches zero the ball is rolling and only the far
 * gentler rolling resistance is left.
 */
export function calcVelocity(b: SimBall): void {
  if (!isMoving(b)) return;
  const s15 = BALL_RADIUS_CM * b.spin.x - b.velocity.y;
  const s16 = -b.velocity.x - b.spin.y * BALL_RADIUS_CM;
  const slip = Math.hypot(s16, s15);
  const slipTime = slip / SLIP_DECAY;
  if (slipTime > MIN_TIME) {
    const dt = slipTime < TICK_SECONDS ? slipTime : TICK_SECONDS;
    const k = (SLIDE_DECEL * dt) / slip;
    const dvx = s16 * k;
    const dvy = s15 * k;
    b.velocity.x += dvx;
    b.velocity.y += dvy;
    b.spin.x -= (dvy * 2.5) / BALL_RADIUS_CM;
    b.spin.y += (dvx * 2.5) / BALL_RADIUS_CM;
  }
  if (slipTime < TICK_SECONDS) {
    const vx = b.velocity.x;
    const vy = b.velocity.y;
    const speed = Math.hypot(vx, vy);
    if (speed > 0) {
      const drop = (TICK_SECONDS - slipTime) * ROLL_DECEL;
      const f = Math.max(0, 1 - drop / speed);
      b.velocity.x = vx * f;
      b.velocity.y = vy * f;
      // Rolling: spin is now locked to velocity.
      b.spin.x = (vy * f) / BALL_RADIUS_CM;
      b.spin.y = -(vx * f) / BALL_RADIUS_CM;
    }
  }
  const dz = ENGLISH_DECAY * TICK_SECONDS;
  b.spin.z = b.spin.z > 0 ? Math.max(b.spin.z - dz, 0) : Math.min(b.spin.z + dz, 0);
}

/**
 * `Prediction::Ball::calcVelocityPostCollision` — a cushion bounce.
 *
 * Rotates into the rail's frame, damps the normal component by 0.804, rubs the
 * tangential one against the cloth inside a Coulomb cone of 0.4, trades that
 * against any english the ball carries, and rotates back. The rail also puts
 * follow on the ball proportional to how hard it arrived. The outgoing angle is
 * therefore **not** the incoming one, which a mirror model cannot express.
 */
export function calcVelocityPostCollision(b: SimBall, angle: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const vx = c * b.velocity.x - s * b.velocity.y;
  const vy = s * b.velocity.x + c * b.velocity.y;

  const slip = vx - BALL_RADIUS_CM * b.spin.z;
  const cone = CUSHION_FRICTION * Math.abs(vy);
  const change = (slip > 0 ? 1 : -1) * Math.min(Math.abs(slip) / 2.5, cone);

  const nvx = vx - change / 2.5;
  const nvy = -CUSHION_RESTITUTION * vy;
  b.velocity.x = s * nvy + c * nvx;
  b.velocity.y = c * nvy - nvx * s;

  const sx = s * b.spin.x + c * b.spin.y;
  const sy = c * b.spin.x - s * b.spin.y - vy * CUSHION_SPIN_GAIN;
  b.spin.z = b.spin.z + change * (2.5 / BALL_RADIUS_CM);
  b.spin.x = s * sx + c * sy;
  b.spin.y = c * sx - sy * s;
}

/** `sub_1C29FA0` — earliest time these two balls touch, within `limit`. */
function ballBallTime(a: SimBall, b: SimBall, limit: number): number | null {
  const rx = b.position.x - a.position.x;
  const ry = b.position.y - a.position.y;
  const dvx = b.velocity.x - a.velocity.x;
  const dvy = b.velocity.y - a.velocity.y;
  const approach = (rx * dvx + ry * dvy) * 2;
  if (approach >= 0) return null;
  const dv2 = dvx * dvx + dvy * dvy;
  const disc = approach * approach - (rx * rx + ry * ry - R2 * 4) * (dv2 * 4);
  if (disc < 0) return null;
  const t = (-approach - Math.sqrt(disc)) / (dv2 * 2);
  if (t < 0 || t - MIN_TIME > limit) return null;
  return t;
}

/** `sub_1BF9ADC` — cheap test for whether the swept path can reach a cushion. */
function mayHitTable(b: SimBall, limit: number): boolean {
  const x1 = b.position.x + b.velocity.x * limit;
  const y1 = b.position.y + b.velocity.y * limit;
  const lo = Math.min(b.position.x, x1);
  const hi = Math.max(b.position.x, x1);
  const bot = Math.min(b.position.y, y1);
  const top = Math.max(b.position.y, y1);
  return lo < -BOUND_X || hi > BOUND_X || bot < -BOUND_Y || top > BOUND_Y;
}

/** `sub_1BC216C` — time to reach a cushion face, offset inward by one radius. */
function lineTime(b: SimBall, a: SimPoint, c: SimPoint, limit: number): number | null {
  if (b.velocity.x === 0 && b.velocity.y === 0) return null;
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const denom = dy * b.velocity.x - dx * b.velocity.y;
  if (denom === 0) return null;
  const inv = 1 / Math.hypot(dx, dy);
  const off = inv * BALL_RADIUS_CM;
  const px = b.position.x - a.x - dy * off;
  const py = b.position.y - a.y + dx * off;
  const along = (px * -b.velocity.y - py * -b.velocity.x) / denom;
  if (along <= 0 || along >= 1) return null;
  const t = (dx * py - dy * px) / denom;
  if (t <= 0 || t - MIN_TIME > limit) return null;
  // Only faces the ball is running into, not ones it is leaving.
  if (b.velocity.x * (dy * inv) + b.velocity.y * -(dx * inv) > 0) return null;
  return t;
}

/** `sub_1C2A594` — time to strike a bare jaw point. */
function pointTime(b: SimBall, p: SimPoint, limit: number): number | null {
  const dx = p.x - b.position.x;
  const dy = p.y - b.position.y;
  const approach = -(b.velocity.x * dx * 2) - b.velocity.y * dy * 2;
  if (approach >= 0) return null;
  const v2 = b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y;
  const d2 = dx * dx + dy * dy;
  const a2 = approach * approach;
  if (d2 - a2 / (v2 * 4) >= R2) return null;
  const t = (-approach - Math.sqrt(a2 - v2 * 4 * (d2 - R2))) / (v2 * 2);
  if (t < 0 || t - MIN_TIME > limit) return null;
  return t;
}

/** `NumberUtils::calcAngle`. */
const angleOf = (x: number, y: number) => Math.atan2(y, x);

interface Pending {
  kind: 'ball' | 'line' | 'point';
  a: SimBall;
  b?: SimBall;
  angle: number;
  point?: SimPoint;
}

/**
 * Run a shot to rest. `balls[0]` must be the cue ball, already given its
 * velocity and spin; every other ball should be at rest.
 */
export function simulate(balls: SimBall[], options?: Partial<SimOptions>): SimResult {
  const opts = { ...DEFAULT_SIM_OPTIONS, ...options };
  const hits: SimBallHit[] = [];
  const cushions: SimCushionHit[] = [];
  const pots: SimPot[] = [];
  const cushionCount = new Map<string, number>();

  for (const b of balls) record(b, true);

  const startedAt = Date.now();
  let ticks = 0;
  for (; ticks < opts.maxTicks; ticks++) {
    // Checked coarsely: Date.now() itself is not free, and 32 ticks is 160 ms
    // of game time, fine-grained enough for a budget measured in wall ms.
    if ((ticks & 31) === 0 && ticks > 0 && Date.now() - startedAt > opts.budgetMs) {
      break;
    }
    let remaining = TICK_SECONDS;
    let substeps = 0;
    do {
      if (++substeps > MAX_SUBSTEPS_PER_TICK) break;
      let step = remaining;
      let pending: Pending | null = null;

      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (!a.onTable) continue;

        if (a.pocketIndex === null) {
          for (let j = i + 1; j < balls.length; j++) {
            const other = balls[j];
            if (!other.onTable || other.pocketIndex !== null) continue;
            const t = ballBallTime(a, other, step);
            if (t !== null) {
              step = t;
              pending = { kind: 'ball', a, b: other, angle: 0 };
            }
          }
        }

        if (!mayHitTable(a, step)) continue;

        // Pocket suction: inside the mouth the game actively pulls the ball in,
        // which is why 8BP pockets accept balls a geometric model would spit out.
        if (a.pocketIndex === null) {
          for (let k = 0; k < POCKETS_CM.length; k++) {
            const dx = POCKETS_CM[k].x - a.position.x;
            const dy = POCKETS_CM[k].y - a.position.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < POCKET_R2) {
              const pull = step * POCKET_PULL;
              a.velocity.x += dx * pull;
              a.velocity.y += dy * pull;
              if (d2 < R2) a.pocketIndex = k;
            }
          }
        }

        for (let k = 0; k < TABLE_SHAPE_CM.length; k++) {
          const p = TABLE_SHAPE_CM[k];
          const q = TABLE_SHAPE_CM[(k + 1) % TABLE_SHAPE_CM.length];
          const lt = lineTime(a, p, q, step);
          if (lt !== null) {
            step = lt;
            pending = { kind: 'line', a, angle: -angleOf(q.x - p.x, q.y - p.y) };
          } else {
            const pt = pointTime(a, p, step);
            if (pt !== null) {
              step = pt;
              pending = { kind: 'point', a, angle: 0, point: p };
            }
          }
        }
      }

      for (const b of balls) {
        if (b.onTable && isMoving(b)) {
          b.position.x += b.velocity.x * step;
          b.position.y += b.velocity.y * step;
          record(b);
        }
      }

      if (pending) resolve(pending, hits, cushions, cushionCount, opts);

      // A ball that reached a pocket this step leaves the table.
      for (const b of balls) {
        if (b.onTable && b.pocketIndex !== null) {
          b.onTable = false;
          b.velocity.x = 0;
          b.velocity.y = 0;
          b.spin.x = b.spin.y = b.spin.z = 0;
          record(b, true);
          pots.push({
            ballId: b.id,
            pocketIndex: b.pocketIndex,
            at: { x: b.position.x, y: b.position.y },
          });
        }
      }

      remaining -= step;
    } while (remaining > MIN_TIME);

    let anyMoving = false;
    for (const b of balls) {
      if (!b.onTable) continue;
      calcVelocity(b);
      // A ball is only at rest when it has stopped *turning* as well. Straight
      // after a full hit the striker's velocity is zero but its roll is not,
      // and that roll is precisely what drags it forward again — zeroing here
      // on speed alone would delete follow and draw from the whole model.
      const surface = Math.hypot(b.spin.x, b.spin.y) * BALL_RADIUS_CM;
      if (
        Math.hypot(b.velocity.x, b.velocity.y) < opts.restSpeed &&
        surface < opts.restSpeed
      ) {
        b.velocity.x = 0;
        b.velocity.y = 0;
        b.spin.x = b.spin.y = b.spin.z = 0;
      } else if (isMoving(b)) {
        anyMoving = true;
      }
    }
    if (!anyMoving) {
      ticks++;
      break;
    }
  }

  for (const b of balls) if (b.onTable) record(b, true);
  return { balls, hits, cushions, pots, ticks };
}

function resolve(
  pending: Pending,
  hits: SimBallHit[],
  cushions: SimCushionHit[],
  cushionCount: Map<string, number>,
  opts: SimOptions
): void {
  const a = pending.a;
  if (pending.kind === 'ball') {
    const b = pending.b!;
    ballBall(a, b, hits);
    return;
  }

  const speedIn = Math.hypot(a.velocity.x, a.velocity.y);
  const incoming =
    speedIn > 0
      ? { x: a.velocity.x / speedIn, y: a.velocity.y / speedIn }
      : { x: 0, y: 0 };

  let angle = pending.angle;
  if (pending.kind === 'point') {
    const p = pending.point!;
    // Bouncing off a jaw point is a bounce off the tangent there.
    angle = -angleOf(p.y - a.position.y, -(p.x - a.position.x));
  }
  calcVelocityPostCollision(a, angle);
  record(a, true);

  const seen = (cushionCount.get(a.id) ?? 0) + 1;
  cushionCount.set(a.id, seen);
  if (seen > opts.maxCushions) {
    a.velocity.x = 0;
    a.velocity.y = 0;
    a.spin.x = a.spin.y = a.spin.z = 0;
    return;
  }

  // The measured rebound, when the game drew one and this is the bounce it
  // described: keep the physics' speed and spin, take the game's direction.
  // `struckBy === null` confines this to the ball the guideline belongs to —
  // the cue ball is the only one that bounces without having been struck.
  const m = opts.measuredBounce;
  if (m !== null && !a.consumedBounce && a.struckBy === null) {
    const mdx = a.position.x - m.x;
    const mdy = a.position.y - m.y;
    if (mdx * mdx + mdy * mdy <= m.tolerance * m.tolerance) {
      a.consumedBounce = true;
      const sp = Math.hypot(a.velocity.x, a.velocity.y);
      if (sp > 0) {
        a.velocity.x = m.dx * sp;
        a.velocity.y = m.dy * sp;
      }
    }
  }

  const speedOut = Math.hypot(a.velocity.x, a.velocity.y);
  cushions.push({
    ballId: a.id,
    at: { x: a.position.x, y: a.position.y },
    incoming,
    outgoing:
      speedOut > 0
        ? { x: a.velocity.x / speedOut, y: a.velocity.y / speedOut }
        : { x: 0, y: 0 },
    speedIn,
    speedOut,
    kind: pending.kind === 'line' ? 'line' : 'point',
  });
}

/**
 * `Prediction::handleBallBallCollision` — a perfectly elastic equal-mass hit.
 *
 * The normal components are simply exchanged. With the target at rest that
 * leaves the striker its tangential component and nothing else, and sends the
 * target off exactly along the line of centres: the 90-degree rule, exactly,
 * with no throw and no energy lost. The striker keeps its **spin** untouched,
 * and that is what curves it afterwards.
 */
function ballBall(a: SimBall, b: SimBall, hits: SimBallHit[]): void {
  const rx = a.position.x - b.position.x;
  const ry = a.position.y - b.position.y;
  const inv = 1 / Math.hypot(rx, ry);
  const nx = rx * inv;
  const ny = ry * inv;

  const speedIn = Math.hypot(a.velocity.x, a.velocity.y);
  const incoming =
    speedIn > 0
      ? { x: a.velocity.x / speedIn, y: a.velocity.y / speedIn }
      : { x: 0, y: 0 };
  const rollFraction =
    speedIn > 0
      ? Math.min(1, (Math.hypot(a.spin.x, a.spin.y) * BALL_RADIUS_CM) / speedIn)
      : 0;

  const an = a.velocity.x * nx + a.velocity.y * ny;
  const bn = b.velocity.x * nx + b.velocity.y * ny;
  const avx = nx * an;
  const avy = ny * an;
  const bvx = nx * bn;
  const bvy = ny * bn;

  a.velocity.x = bvx - (avx - a.velocity.x);
  a.velocity.y = bvy - (avy - a.velocity.y);
  b.velocity.x = avx - (bvx - b.velocity.x);
  b.velocity.y = avy - (bvy - b.velocity.y);

  if (b.struckBy === null) b.struckBy = a.id;
  record(a, true);
  record(b, true);
  if (a.firstImpactAt === null) a.firstImpactAt = a.path.length - 1;

  const targetSpeed = Math.hypot(b.velocity.x, b.velocity.y);
  const tangentSpeed = Math.hypot(a.velocity.x, a.velocity.y);
  // The line of centres runs ghost -> target, which is -n.
  const cut = Math.acos(Math.min(1, Math.max(-1, -(incoming.x * nx + incoming.y * ny))));
  hits.push({
    sourceId: a.id,
    targetId: b.id,
    ghost: { x: a.position.x, y: a.position.y },
    targetCentre: { x: b.position.x, y: b.position.y },
    normal: { x: -nx, y: -ny },
    incoming,
    speedIn,
    cutAngle: cut,
    targetDir:
      targetSpeed > 0
        ? { x: b.velocity.x / targetSpeed, y: b.velocity.y / targetSpeed }
        : { x: -nx, y: -ny },
    targetSpeed,
    tangentDir:
      tangentSpeed > 0
        ? { x: a.velocity.x / tangentSpeed, y: a.velocity.y / tangentSpeed }
        : { x: 0, y: 0 },
    tangentSpeed,
    rollFraction,
  });
}
