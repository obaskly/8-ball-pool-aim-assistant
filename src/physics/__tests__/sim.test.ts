import { describe, expect, it } from 'vitest';

import {
  BALL_RADIUS_CM,
  DEFAULT_CUE_POWER,
  freeRunDistance,
  launchSpeed,
} from '../gamePhysics';
import { POCKETS_CM } from '../table8bp';
import { simulate, type SimBall } from '../sim';

const ball = (id: string, x: number, y: number): SimBall => ({
  id,
  position: { x, y },
  velocity: { x: 0, y: 0 },
  spin: { x: 0, y: 0, z: 0 },
  onTable: true,
  pocketIndex: null,
  path: [],
  speeds: [],
  firstImpactAt: null,
  struckBy: null,
  pinned: 0,
});

/** A cue ball struck through its centre — no spin, the way the game starts it. */
function cue(x: number, y: number, speed: number, angleDeg = 0): SimBall {
  const a = (angleDeg * Math.PI) / 180;
  const b = ball('cue', x, y);
  b.velocity = { x: speed * Math.cos(a), y: speed * Math.sin(a) };
  return b;
}

const pathLength = (b: SimBall) => {
  let d = 0;
  for (let i = 1; i < b.path.length; i++) {
    d += Math.hypot(b.path[i].x - b.path[i - 1].x, b.path[i].y - b.path[i - 1].y);
  }
  return d;
};

const degrees = (v: { x: number; y: number }) => (Math.atan2(v.y, v.x) * 180) / Math.PI;

describe('free running', () => {
  it('runs the distance the closed form predicts', () => {
    // Down the middle of the table, aimed at nothing, soft enough to stop
    // before the far cushion.
    const speed = 90;
    const c = cue(-100, 0, speed);
    const r = simulate([c], { maxTicks: 20000, restSpeed: 0.01, maxCushions: 0 });
    expect(r.cushions).toHaveLength(0);
    expect(pathLength(c)).toBeCloseTo(freeRunDistance(speed), 0);
  });

  it('collapses a straight run to two points', () => {
    const c = cue(-100, 0, 90);
    simulate([c], { maxTicks: 20000, restSpeed: 0.01, maxCushions: 0 });
    expect(c.path.length).toBe(2);
  });

  it('leaves the ball at rest on the table', () => {
    const c = cue(-100, 0, 90);
    simulate([c], { maxTicks: 20000, restSpeed: 0.01, maxCushions: 0 });
    expect(c.onTable).toBe(true);
    expect(Math.hypot(c.velocity.x, c.velocity.y)).toBeLessThan(0.02);
  });
});

describe('ball on ball', () => {
  it('sends the object ball along the line of centres and stuns the cue dead', () => {
    // Full hit, hard enough that the cue ball is still sliding when it arrives.
    const c = cue(-100, 0, launchSpeed(1, DEFAULT_CUE_POWER));
    const t = ball('t', -20, 0);
    const r = simulate([c, t], { maxCushions: 0 });

    expect(r.hits).toHaveLength(1);
    const hit = r.hits[0];
    expect(hit.sourceId).toBe('cue');
    expect(hit.targetId).toBe('t');
    expect(hit.cutAngle).toBeCloseTo(0, 6);
    expect(degrees(hit.targetDir)).toBeCloseTo(0, 4);
    // Everything went into the object ball: a stun shot stops dead.
    expect(hit.tangentSpeed).toBeLessThan(1e-9);
  });

  it('separates cue and object by exactly 90 degrees on a cut', () => {
    const offset = 2 * BALL_RADIUS_CM * Math.sin(Math.PI / 4);
    const c = cue(-100, 0, launchSpeed(1));
    const t = ball('t', -20, offset);
    const r = simulate([c, t], { maxCushions: 0 });

    expect(r.hits).toHaveLength(1);
    const hit = r.hits[0];
    expect((hit.cutAngle * 180) / Math.PI).toBeCloseTo(45, 3);
    const dot = hit.targetDir.x * hit.tangentDir.x + hit.targetDir.y * hit.tangentDir.y;
    expect(dot).toBeCloseTo(0, 6);
  });

  it('conserves energy across the split', () => {
    const offset = 2 * BALL_RADIUS_CM * Math.sin(Math.PI / 6);
    const speed = launchSpeed(1);
    const c = cue(-100, 0, speed);
    const t = ball('t', -20, offset);
    const r = simulate([c, t], { maxCushions: 0 });

    const hit = r.hits[0];
    const inSq = hit.speedIn * hit.speedIn;
    expect(hit.targetSpeed ** 2 + hit.tangentSpeed ** 2).toBeCloseTo(inSq, 3);
  });
});

describe('the cue ball curves after contact', () => {
  it('leaves on the tangent and then bends back toward its old line', () => {
    // A near-full hit at low power: the cue ball keeps almost no speed but all
    // of its roll, so the cloth drags it forward hard. This is the behaviour a
    // single departure angle cannot express, and the reason for stepping.
    const offset = 2 * BALL_RADIUS_CM * Math.sin((15 * Math.PI) / 180);
    const c = cue(-100, 0, launchSpeed(0.3));
    const t = ball('t', -20, offset);
    const r = simulate([c, t], { maxCushions: 0 });

    const hit = r.hits[0];
    const tangent = degrees(hit.tangentDir);
    // Where it actually ended up, measured from the contact.
    const start = c.path[c.firstImpactAt!];
    const end = c.path[c.path.length - 1];
    const net = degrees({ x: end.x - start.x, y: end.y - start.y });

    expect(Math.abs(tangent)).toBeGreaterThan(70); // left near 90 off the line
    expect(Math.abs(net)).toBeLessThan(Math.abs(tangent) - 15); // bent well back

    // It is a curve, not a corner: the first heading after contact is the
    // tangent, and the ball is pointing somewhere else by the end of it.
    const heading = (i: number) => {
      const a = c.path[i];
      const b = c.path[i + 1];
      return degrees({ x: b.x - a.x, y: b.y - a.y });
    };
    const leaves = heading(c.firstImpactAt!);
    const settles = heading(c.path.length - 2);
    expect(Math.abs(leaves - tangent)).toBeLessThan(6);
    expect(Math.abs(settles - leaves)).toBeGreaterThan(10);
  });

  it('barely bends on a thin cut at speed, where roll and velocity agree', () => {
    const offset = 2 * BALL_RADIUS_CM * Math.sin((60 * Math.PI) / 180);
    const c = cue(-100, 0, launchSpeed(0.9));
    const t = ball('t', -20, offset);
    const r = simulate([c, t], { maxCushions: 0 });

    const hit = r.hits[0];
    const tangent = degrees(hit.tangentDir);
    const start = c.path[c.firstImpactAt!];
    const mid = c.path[Math.min(c.path.length - 1, c.firstImpactAt! + 2)];
    const net = degrees({ x: mid.x - start.x, y: mid.y - start.y });
    expect(Math.abs(net - tangent)).toBeLessThan(12);
  });
});

describe('cushions', () => {
  it('comes off shallower than a mirror, because only the normal is damped', () => {
    const c = cue(-60, -40, 200, 45);
    const r = simulate([c], { maxCushions: 1, maxTicks: 4000 });
    expect(r.cushions.length).toBeGreaterThanOrEqual(1);
    const hit = r.cushions[0];
    const inAngle = Math.abs(degrees(hit.incoming));
    const outAngle = Math.abs(degrees(hit.outgoing));
    expect(outAngle).toBeLessThan(inAngle);
    expect(inAngle - outAngle).toBeGreaterThan(0.3);
    expect(inAngle - outAngle).toBeLessThan(6);
    expect(hit.speedOut).toBeLessThan(hit.speedIn);
  });

  it('keeps every ball inside the cushions', () => {
    const c = cue(-100, -20, launchSpeed(0.8), 27);
    const r = simulate([c], { maxCushions: 6, maxTicks: 6000 });
    for (const p of c.path) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(127 + 1e-6);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(76.8);
    }
    expect(r.cushions.length).toBeGreaterThan(0);
  });
});

describe('pockets', () => {
  it('pots a ball rolled straight at a corner', () => {
    const corner = POCKETS_CM[2]; // +x, -y corner
    const c = ball('cue', 100, -20);
    const dx = corner.x - c.position.x;
    const dy = corner.y - c.position.y;
    const d = Math.hypot(dx, dy);
    const speed = 150;
    c.velocity = { x: (dx / d) * speed, y: (dy / d) * speed };

    const r = simulate([c], { maxTicks: 4000, maxCushions: 2 });
    expect(r.pots).toHaveLength(1);
    expect(r.pots[0].ballId).toBe('cue');
    expect(c.onTable).toBe(false);
  });

  it('swallows a ball that only clips the mouth, the way the game does', () => {
    // Aimed 5 cm wide of the side pocket centre — a purely geometric model
    // lets this one straight past, because 5 cm clears the 3.8 cm capture.
    const pocket = POCKETS_CM[4]; // (0, +72)
    const c = ball('cue', 0, 20);
    const dx = pocket.x - c.position.x;
    const dy = pocket.y - c.position.y;
    const d = Math.hypot(dx, dy);
    const aimX = pocket.x + (-dy / d) * 5;
    const aimY = pocket.y + (dx / d) * 5;
    const ax = aimX - c.position.x;
    const ay = aimY - c.position.y;
    const ad = Math.hypot(ax, ay);
    c.velocity = { x: (ax / ad) * 150, y: (ay / ad) * 150 };

    const r = simulate([c], { maxTicks: 4000, maxCushions: 3 });
    expect(r.pots.map((p) => p.ballId)).toContain('cue');
    // The pull is what did it: it ends up well inside a radius of the centre.
    const closest = Math.min(
      ...c.path.map((p) => Math.hypot(p.x - pocket.x, p.y - pocket.y))
    );
    expect(closest).toBeLessThan(3.8);
  });
});

describe('simultaneous motion', () => {
  it('lets a struck ball get clear before the cue ball arrives behind it', () => {
    // Three in a line. The cue ball drives 'a' into 'b'; because everything
    // moves together, 'a' is genuinely gone by the time the cue ball rolls on,
    // rather than being resolved away first.
    const c = cue(-110, 0, launchSpeed(0.6));
    const a = ball('a', -40, 0);
    const b = ball('b', 40, 0);
    const r = simulate([c, a, b], { maxCushions: 1 });

    const order = r.hits.map((h) => `${h.sourceId}->${h.targetId}`);
    expect(order[0]).toBe('cue->a');
    expect(order).toContain('a->b');
    expect(a.struckBy).toBe('cue');
    expect(b.struckBy).toBe('a');
  });
});

describe('bounded work', () => {
  // The stepper runs on the UI thread and the phone runs it interpreted, so
  // these are liveness guarantees, not performance preferences: the one
  // session-killing failure this code has had was a prediction that outran the
  // frame loop until the app could no longer even process its own Stop button.

  it('a full rack break lands inside the wall-clock budget', () => {
    const balls: SimBall[] = [cue(-80, 0, launchSpeed(1, DEFAULT_CUE_POWER), 1)];
    let n = 0;
    for (let row = 0; row < 5; row++) {
      for (let k = 0; k <= row; k++) {
        balls.push(ball(`b${n++}`, 60 + row * 6.6, (k - row / 2) * 7.7));
      }
    }
    const t0 = Date.now();
    simulate(balls, { budgetMs: 5 });
    // Generous slack over the budget: one tick can overrun, the check cannot.
    expect(Date.now() - t0).toBeLessThan(60);
  });

  it('a ball wedged into a jaw under pocket suction still terminates', () => {
    // Parked touching the jaw vertex inside the suction field and pushed in:
    // the configuration whose collisions can cost zero time each. The substep
    // cap is what bounds this; the budget is the net under it.
    const b = ball('cue', -127 + 3.81, 53.5 + 3.81);
    b.velocity = { x: -40, y: 40 };
    const t0 = Date.now();
    const r = simulate([b], { budgetMs: 5 });
    expect(Date.now() - t0).toBeLessThan(60);
    expect(r.ticks).toBeGreaterThan(0);
  });

  it('truncation keeps the near part of the path', () => {
    const c = cue(-100, 0, launchSpeed(1, DEFAULT_CUE_POWER));
    const full = simulate([cue(-100, 0, launchSpeed(1, DEFAULT_CUE_POWER))]);
    const cut = simulate([c], { maxTicks: 100 });
    // The truncated run is a prefix, not a different answer.
    expect(pathLength(c)).toBeLessThan(pathLength(full.balls[0]));
    expect(c.path[0].x).toBeCloseTo(full.balls[0].path[0].x, 6);
  });
});

describe('measured first bounce', () => {
  // The game draws its own rebound stub where the guideline meets a rail, and
  // that drawing already contains its whole cushion response. When the caller
  // hands the stub in, the first bounce takes the measured direction and keeps
  // the physics' speed — everything downstream then starts from the game's own
  // answer instead of from our accumulated error.
  it('takes the measured direction and keeps the simulated speed', () => {
    const run = (measured: boolean) => {
      const c = cue(0, 0, 300, 60); // up-right into the top cushion
      const r = simulate([c], {
        maxCushions: 2,
        measuredBounce: measured
          ? // At the natural contact, but leaving 6 degrees shallower.
            { x: 33.9, y: 59.7, dx: Math.cos(-0.55), dy: Math.sin(-0.55), tolerance: 12 }
          : null,
      });
      return r.cushions[0];
    };

    const natural = run(false);
    const overridden = run(true);
    expect(natural).toBeDefined();
    expect(overridden).toBeDefined();
    // Direction follows the measurement...
    expect(Math.atan2(overridden.outgoing.y, overridden.outgoing.x)).toBeCloseTo(-0.55, 2);
    expect(
      Math.atan2(natural.outgoing.y, natural.outgoing.x)
    ).not.toBeCloseTo(-0.55, 2);
    // ...while the energy loss is still the physics'.
    expect(overridden.speedOut).toBeCloseTo(natural.speedOut, 6);
  });

  it('ignores a measurement that is nowhere near the real contact', () => {
    const c = cue(0, 0, 300, 60);
    const r = simulate([c], {
      maxCushions: 2,
      measuredBounce: { x: -80, y: -50, dx: 1, dy: 0, tolerance: 10 },
    });
    const natural = simulate([cue(0, 0, 300, 60)], { maxCushions: 2 }).cushions[0];
    expect(r.cushions[0].outgoing.x).toBeCloseTo(natural.outgoing.x, 6);
  });
});
