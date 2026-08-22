import { describe, expect, it } from 'vitest';
import { createRectTable, solveGhostBall } from '../geometry';
import { reflectOffCushion } from '../cushion';
import { resolveBallImpact } from '../collision';
import { predictShot, predictShotAnalytic } from '../engine';
import { BALL_RADIUS_TO_WIDTH_EXACT, launchFraction } from '../gamePhysics';
import { angleBetween, dot, normalize, sub, vec } from '../vec2';
import type { Ball, World } from '../types';

// Game-true proportions. The simulation places contacts at 8 Ball Pool's own
// ball radius, so a fixture that declares some other ratio to its table is
// describing a table the game does not have, and every ghost ball lands
// somewhere the engine will not agree with.
const R = 1000 * BALL_RADIUS_TO_WIDTH_EXACT; // 14.9625 on this 1000px table
const table = createRectTable({
  playfield: { left: 0, top: 0, right: 1000, bottom: 500 },
  ballRadius: R,
  cornerCaptureRadius: 25,
  sideCaptureRadius: 20,
});

const ball = (id: string, x: number, y: number, kind: Ball['kind'] = 'solid'): Ball => ({
  id,
  position: vec(x, y),
  radius: R,
  kind,
});

const world = (...balls: Ball[]): World => ({ table, balls });

describe('ball-to-ball impact', () => {
  it('sends the object ball along the line of centres and stops the cue on a full hit', () => {
    const c = resolveBallImpact('cue', 't', vec(280, 250), vec(300, 250), vec(1, 0), 1);
    expect(c.cutAngle).toBeCloseTo(0, 9);
    expect(c.targetDirection.x).toBeCloseTo(1, 9);
    expect(c.targetSpeed).toBeCloseTo(1, 9);
    expect(c.tangentSpeed).toBeCloseTo(0, 9);
  });

  it('separates cue and object by exactly 90 degrees on a cut', () => {
    // Target offset so the line of centres sits at 45 degrees to the travel line.
    const offset = 2 * R * Math.sin(Math.PI / 4);
    const gx = 300 - Math.sqrt(4 * R * R - offset * offset);
    const c = resolveBallImpact('cue', 't', vec(gx, 0), vec(300, offset), vec(1, 0), 1);

    expect(c.cutAngle).toBeCloseTo(Math.PI / 4, 6);
    expect(angleBetween(c.targetDirection, c.tangentDirection)).toBeCloseTo(Math.PI / 2, 9);
    expect(dot(c.targetDirection, c.tangentDirection)).toBeCloseTo(0, 9);
  });

  it('conserves energy across the split for any cut angle', () => {
    for (const deg of [0, 15, 30, 45, 60, 75, 89]) {
      const theta = (deg * Math.PI) / 180;
      const offset = 2 * R * Math.sin(theta);
      const gx = 300 - Math.sqrt(Math.max(0, 4 * R * R - offset * offset));
      const c = resolveBallImpact('cue', 't', vec(gx, 0), vec(300, offset), vec(1, 0), 1);

      expect(c.cutAngle).toBeCloseTo(theta, 5);
      expect(c.targetSpeed).toBeCloseTo(Math.cos(theta), 5);
      expect(c.tangentSpeed).toBeCloseTo(Math.sin(theta), 5);
      // v_target^2 + v_tangent^2 === v_in^2
      expect(c.targetSpeed ** 2 + c.tangentSpeed ** 2).toBeCloseTo(1, 5);
    }
  });
});

describe('cushion reflection', () => {
  const incoming = normalize(vec(1, -1)); // 45 degrees into the top cushion
  const topNormal = vec(0, 1);

  it('preserves the angle and scales speed by e in angle-preserving mode', () => {
    const r = reflectOffCushion(incoming, 1, topNormal, 0.9, true);
    expect(r.incidentAngle).toBeCloseTo(Math.PI / 4, 9);
    expect(r.reflectionAngle).toBeCloseTo(r.incidentAngle, 9);
    expect(r.direction.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(r.direction.y).toBeCloseTo(Math.SQRT1_2, 9);
    expect(r.speed).toBeCloseTo(0.9, 9);
  });

  it('bends the path when only the normal component is damped', () => {
    const r = reflectOffCushion(incoming, 1, topNormal, 0.9, false);
    // Documented consequence: theta_i and theta_r cannot both hold with e < 1.
    expect(r.reflectionAngle).not.toBeCloseTo(r.incidentAngle, 3);
    expect(r.speed).toBeCloseTo(Math.hypot(Math.SQRT1_2, 0.9 * Math.SQRT1_2), 9);
  });

  it('reverses a head-on hit', () => {
    const r = reflectOffCushion(vec(0, -1), 1, topNormal, 0.9, true);
    expect(r.direction.y).toBeCloseTo(1, 9);
    expect(r.incidentAngle).toBeCloseTo(0, 9);
  });
});

describe('ghost ball aim solve', () => {
  it('produces an aim line that sends the object ball at the pocket', () => {
    const cue = vec(100, 400);
    const target = vec(500, 250);
    const pocket = vec(1000, 0);

    const solved = solveGhostBall(cue, target, pocket, R);
    expect(solved).not.toBeNull();

    const w = world(
      { id: 'cue', position: cue, radius: R, kind: 'cue' },
      ball('t', 500, 250)
    );
    const p = predictShot(w, { direction: solved!.aimDirection, power: 1 });

    expect(p.primaryContact?.targetId).toBe('t');
    const sent = p.primaryContact!.targetDirection;
    const wanted = normalize(sub(pocket, target));
    expect(angleBetween(sent, wanted)).toBeLessThan(1e-6);
    expect(p.potted.map((x) => x.ballId)).toContain('t');
  });

  it('rejects cuts of 90 degrees or more', () => {
    // Pocket directly behind the target relative to the cue: impossible.
    expect(solveGhostBall(vec(600, 250), vec(500, 250), vec(1000, 250), R)).toBeNull();
  });
});

describe('predictShot', () => {
  it('bounces off a cushion with equal angles and reduced speed', () => {
    const w = world({ id: 'cue', position: vec(500, 250), radius: R, kind: 'cue' });
    // Equal angles is the analytic model's simplification. The game damps the
    // normal and rubs the tangent, so the simulation deliberately does not
    // reproduce it — see the cushion tests in ./sim.test.ts.
    const p = predictShotAnalytic(w, { direction: vec(1, -1), power: 1 }, { maxCushions: 1 });

    expect(p.cushionContacts).toHaveLength(1);
    const c = p.cushionContacts[0];
    expect(c.railId).toBe('top');
    expect(c.incidentAngle).toBeCloseTo(c.reflectionAngle, 9);
    expect(c.speedOut / c.speedIn).toBeCloseTo(0.9, 9);
    // Contact sits one ball radius off the cushion face.
    expect(c.at.y).toBeCloseTo(R, 6);
  });

  it('keeps every point of every path inside the table', () => {
    const w = world(
      { id: 'cue', position: vec(120, 300), radius: R, kind: 'cue' },
      ball('a', 640, 190),
      ball('b', 800, 360)
    );
    const p = predictShot(w, { direction: vec(2, -1), power: 1 }, { maxCushions: 6, maxDepth: 3 });

    for (const s of p.segments) {
      for (const pt of [s.from, s.to]) {
        expect(pt.x).toBeGreaterThanOrEqual(-1e-6);
        expect(pt.x).toBeLessThanOrEqual(1000 + 1e-6);
        expect(pt.y).toBeGreaterThanOrEqual(-1e-6);
        expect(pt.y).toBeLessThanOrEqual(500 + 1e-6);
      }
    }
  });

  it('follows a secondary collision into a third ball', () => {
    // Cue hits A; A is aimed straight into B.
    const w = world(
      { id: 'cue', position: vec(100, 250), radius: R, kind: 'cue' },
      ball('a', 400, 250),
      ball('b', 700, 250)
    );
    const p = predictShot(
      w,
      { direction: vec(1, 0), power: 0.35, cueBallId: 'cue' },
      { maxDepth: 2, maxCushions: 0 }
    );

    expect(p.root.impact?.targetId).toBe('a');
    // Soft enough that the cue ball has rolled by the time it arrives, so it
    // follows through the full hit rather than stunning dead on it.
    expect(p.root.termination).toBe('stopped');
    expect(p.root.children).toHaveLength(1);

    const a = p.root.children[0];
    expect(a.ballId).toBe('a');
    expect(a.impact?.targetId).toBe('b');
    expect(a.children[0]?.ballId).toBe('b');
    expect(p.ballContacts).toHaveLength(2);
  });

  it('respects maxDepth', () => {
    const w = world(
      { id: 'cue', position: vec(100, 250), radius: R, kind: 'cue' },
      ball('a', 400, 250),
      ball('b', 700, 250)
    );
    const shallow = predictShot(
      w,
      { direction: vec(1, 0), power: 0.35 },
      { maxDepth: 0, maxCushions: 0 }
    );
    expect(shallow.root.children).toHaveLength(0);
    expect(shallow.ballContacts).toHaveLength(1);
  });

  it('stops the cue ball when it runs out of energy', () => {
    const w = world({ id: 'cue', position: vec(500, 250), radius: R, kind: 'cue' });
    // A fixed travel budget is an analytic-engine idea; the simulation runs the
    // ball down under real friction instead.
    const p = predictShotAnalytic(
      w,
      { direction: vec(1, 0), power: 0.2 },
      { fullPowerTravel: 1000, maxCushions: 0 }
    );
    expect(p.root.termination).toBe('stopped');
    // The meter goes through the game's curve before it is a speed, so the
    // budget is launchFraction(0.2)^2 * 1000 = 0.10557^2 * 1000, not 0.2^2.
    const travelled = p.segments.reduce((s, x) => s + x.length, 0);
    const speed = launchFraction(0.2);
    expect(travelled).toBeCloseTo(speed * speed * 1000, 6);
  });

  it('pots a ball rolled straight at a corner pocket', () => {
    const w = world({ id: 'cue', position: vec(500, 250), radius: R, kind: 'cue' });
    const p = predictShot(w, { direction: sub(vec(1000, 0), vec(500, 250)), power: 1 });
    expect(p.root.termination).toBe('potted');
    expect(p.potted[0].pocketId).toBe('top-right');
  });

  it('is deterministic', () => {
    const w = world(
      { id: 'cue', position: vec(137, 291), radius: R, kind: 'cue' },
      ball('a', 523, 197),
      ball('b', 744, 355)
    );
    const shot = { direction: vec(3, -1), power: 0.85 };
    const a = JSON.stringify(predictShot(w, shot));
    const b = JSON.stringify(predictShot(w, shot));
    expect(a).toBe(b);
  });

  it('tags cue segments primary before contact and tangent after', () => {
    const offset = 2 * R * Math.sin(Math.PI / 6);
    const w = world(
      { id: 'cue', position: vec(100, 250), radius: R, kind: 'cue' },
      ball('a', 500, 250 + offset)
    );
    const p = predictShot(w, { direction: vec(1, 0), power: 1 });
    const cueSegs = p.segments.filter((s) => s.ballId === 'cue');
    expect(cueSegs[0].role).toBe('primary');
    expect(cueSegs.some((s) => s.role === 'tangent')).toBe(true);
    expect(p.segments.some((s) => s.ballId === 'a' && s.role === 'object')).toBe(true);
  });
});

/**
 * The case the measurement exists for: the cue ball's line passes a hair outside
 * a ball on its way to the far cushion. Nearest-wins has to call that a hit —
 * from the geometry alone it may well be one — and the prediction then bends 90
 * degrees away from where the game says the shot is going.
 */
// `firstContact` disambiguates which obstruction the guideline ended on, which
// only makes sense for a cast that has to choose. The simulation does not
// choose — it resolves whatever the aim actually reaches — so this measurement
// is spent on the aim instead, via `contactPoint`. The behaviour still exists
// on the analytic engine and is still worth holding to.
describe('measured first contact (analytic engine)', () => {
  const cue = { id: 'cue', position: vec(100, 250), radius: R, kind: 'cue' } as const;
  const straight = { direction: vec(1, 0), power: 1 };
  /** Cue ball at x=100 rolling right; the far cushion stops its centre at 990. */
  const RAIL = 1000 - R - 100; // cushion stops the centre one radius short

  /** Ball 'a' at x=500, `off` px off the line of centres. Contact needs 2R. */
  const brushed = (off: number) => world({ ...cue }, ball('a', 500, 250 + off));

  /** Where the cue ball's own path first stops, whatever stopped it. */
  const firstEvent = (p: ReturnType<typeof predictShot>) => p.segments[0].length;

  it('takes the obstruction the measurement points at, not the nearest one', () => {
    // 1 px inside contact: a hit, and at 394 px it is much the nearest thing.
    const w = () => brushed(2 * R - 1);
    const bare = predictShotAnalytic(w(), straight);
    expect(bare.primaryContact?.targetId).toBe('a');
    expect(firstEvent(bare)).toBeCloseTo(
      500 - Math.sqrt((2 * R) ** 2 - (2 * R - 1) ** 2) - 100,
      0
    );

    // But the game drew its line all the way to the cushion, so it was a miss:
    // the cue ball rolls past and the first thing it meets is the rail. (It
    // does come back and hit the ball on the rebound, which is the right
    // answer and a completely different picture.)
    const p = predictShotAnalytic(w(), { ...straight, firstContact: RAIL });
    expect(firstEvent(p)).toBeCloseTo(RAIL, 6);
    expect(p.cushionContacts[0].railId).toBe('right');
  });

  it('accepts a graze the cast alone would have called a miss', () => {
    // 3 px outside contact, which is inside the 0.55-radii graze allowance.
    const w = () => brushed(2 * R + 3);
    expect(predictShotAnalytic(w(), straight).primaryContact).toBeUndefined();

    const p = predictShotAnalytic(w(), { ...straight, firstContact: 400 });
    expect(p.primaryContact?.targetId).toBe('a');
    expect(firstEvent(p)).toBeCloseTo(400, 6);
  });

  it('will not rescue a miss the measurement does not vouch for', () => {
    // Same near miss, but the line runs to the cushion: still a miss.
    const p = predictShotAnalytic(brushed(2 * R + 3), { ...straight, firstContact: RAIL });
    expect(p.primaryContact).toBeUndefined();
    expect(firstEvent(p)).toBeCloseTo(RAIL, 6);
    expect(p.cushionContacts[0].railId).toBe('right');
  });

  it('falls back to nearest when nothing in the scene is at that distance', () => {
    // Nothing sits at 200 px, so the measurement says only that the detected
    // scene is wrong. Better to draw the old answer than to draw nothing.
    const hinted = predictShotAnalytic(brushed(2 * R - 1), { ...straight, firstContact: 200 });
    const bare = predictShotAnalytic(brushed(2 * R - 1), straight);
    expect(JSON.stringify(hinted)).toBe(JSON.stringify(bare));
  });

  it('spends the measurement on the first event only', () => {
    // Nothing on the table but the cue ball, so the hint matches the cushion.
    // The rebound has to resolve on its own rather than hunting for a second
    // obstruction another 890 px along.
    const p = predictShotAnalytic(
      world({ ...cue }),
      { ...straight, firstContact: RAIL },
      { maxCushions: 2 }
    );
    expect(p.cushionContacts.map((c) => c.railId)).toEqual(['right', 'left']);
  });

  it('ignores a measurement of zero', () => {
    const hinted = predictShotAnalytic(brushed(2 * R - 1), { ...straight, firstContact: 0 });
    const bare = predictShotAnalytic(brushed(2 * R - 1), straight);
    expect(JSON.stringify(hinted)).toBe(JSON.stringify(bare));
  });
});

describe('measured contact point', () => {
  const cue = { id: 'cue', position: vec(100, 250), radius: R, kind: 'cue' } as const;
  const straight = { direction: vec(1, 0), power: 1 };
  /** Ball 'a' square in the way at x=500, so the cast contact is (500-2R, 250). */
  const w = () => world({ ...cue }, ball('a', 500, 250));
  const castContact = vec(500 - 2 * R, 250);
  const objectDir = (p: ReturnType<typeof predictShot>) => {
    const c = p.ballContacts[0];
    return (Math.atan2(c.targetDirection.y, c.targetDirection.x) * 180) / Math.PI;
  };

  it('sends the object ball along the line from the measured contact', () => {
    // Same ball, same aim, but the game drew its ghost a little above the line
    // of centres, so this is really a cut and not a straight pot.
    const off = 6;
    const measured = vec(castContact.x, castContact.y - off);
    const p = predictShot(w(), { ...straight, contactPoint: measured });

    expect(p.ballContacts[0].targetId).toBe('a');
    // Departure runs from the measured contact to the ball's centre.
    // Within a quarter degree: the simulation puts the contact where the balls
    // actually touch given the corrected aim, rather than snapping it onto the
    // measured circle, so the two answers differ by a fraction of a pixel.
    expect(objectDir(p)).toBeCloseTo((Math.atan2(off, 2 * R) * 180) / Math.PI, 0);
    // And that is a long way from what the cast alone said: over a baseline of
    // one diameter, six pixels is better than ten degrees.
    expect(objectDir(predictShot(w(), straight))).toBeCloseTo(0, 0);
  });

  it('ignores a circle that is nowhere near the contact we found', () => {
    const far = vec(castContact.x - 4 * R, castContact.y);
    const p = predictShot(w(), { ...straight, contactPoint: far });
    expect(p.segments[0].length).toBeCloseTo(500 - 2 * R - 100, 0);
  });

  it('ignores a circle that is not a ball diameter from the ball it hits', () => {
    // Within the trust window, but far too close to the ball to be its ghost.
    const wrong = vec(castContact.x + R, castContact.y);
    const p = predictShot(w(), { ...straight, contactPoint: wrong });
    expect(p.segments[0].length).toBeCloseTo(500 - 2 * R - 100, 0);
  });

  it('re-points the travel direction at the contact it measured', () => {
    const measured = vec(castContact.x, castContact.y - 6);
    const p = predictShot(w(), { ...straight, contactPoint: measured });
    const first = p.segments[0];
    // Within about a pixel. The aim is re-pointed at the measured circle, but
    // the contact itself is then placed where the balls actually touch given
    // that aim, rather than being snapped onto the circle — so the two answers
    // sit a fraction of a pixel apart instead of coinciding exactly.
    expect(Math.hypot(first.to.x - measured.x, first.to.y - measured.y)).toBeLessThan(1.5);
  });

  it('leaves a cushion prediction alone', () => {
    // No ghost ball is drawn for a cushion, and even a stray circle must not
    // move a rebound: this is the case that already aims true.
    const empty = world({ ...cue });
    const bare = predictShot(empty, straight);
    const p = predictShot(empty, { ...straight, contactPoint: vec(700, 250) });
    expect(p.segments[0].length).toBeCloseTo(bare.segments[0].length, 0);
    expect(p.cushionContacts[0].railId).toBe('right');
  });

  it('spends the measurement on the first contact only', () => {
    // A circle sitting on a later ball must not drag the second impact around.
    const two = world({ ...cue }, ball('a', 500, 250), ball('b', 800, 250));
    const p = predictShot(two, { ...straight, contactPoint: vec(800 - 2 * R, 244) });
    expect(p.segments[0].length).toBeCloseTo(500 - 2 * R - 100, 0);
  });
});

describe('rolling cue ball', () => {
  /** Deflection of the striker off its original heading, in degrees. */
  const deflection = (cutDeg: number, roll: number) => {
    const th = (cutDeg * Math.PI) / 180;
    // Cue travels along +x; put the target one diameter away at the cut angle.
    const ghost = vec(0, 0);
    const target = vec(2 * R * Math.cos(th), 2 * R * Math.sin(th));
    const c = resolveBallImpact('cue', 't', ghost, target, vec(1, 0), 1, roll);
    return {
      deg: (angleBetween(vec(1, 0), c.departDirection) * 180) / Math.PI,
      speed: c.departSpeed,
    };
  };

  it('reproduces the published rolling-ball deflection angles', () => {
    // Dr. Dave's table for a rolling cue ball: the 30-degree rule in the middle,
    // falling away to a thin-hit 70% of the cut at the edges.
    for (const [cut, expected] of [
      [15, 28.2],
      [30, 33.7],
      [45, 29.1],
      [60, 20.6],
      [75, 10.6],
    ]) {
      expect(deflection(cut, 1).deg).toBeCloseTo(expected, 1);
    }
  });

  it('leaves the striker on the bare tangent when it arrives sliding', () => {
    for (const cut of [15, 30, 45, 60, 75]) {
      expect(deflection(cut, 0).deg).toBeCloseTo(90 - cut, 6);
    }
  });

  it('follows through on a straight hit instead of stunning', () => {
    const rolling = deflection(0, 1);
    expect(rolling.deg).toBeCloseTo(0, 6); // straight on, not sideways
    expect(rolling.speed).toBeCloseTo(2 / 7, 6);

    expect(deflection(0, 0).speed).toBeCloseTo(0, 9); // sliding: dead stop
  });

  it('spins up with distance, so a short shot arrives stunned and a long one rolling', () => {
    const cue: Ball = { id: 'cue', position: vec(100, 250), radius: R, kind: 'cue' };
    const at = (x: number) => {
      const p = predictShot(
        world({ ...cue }, ball('a', x, 250), ball('b', x, 100)),
        { direction: vec(1, 0), power: 0.5 }
      );
      return p.root.impact!.rollFraction;
    };
    // Slide length goes as speed^2, and at full power it is now nearly four
    // table lengths — a hard shot is *still sliding* when it arrives, which is
    // exactly why the game draws a 90-degree line. Half a meter brings the
    // slide down to ~330 units, the range this fixture can actually show.
    expect(at(150)).toBeLessThan(0.35);
    expect(at(150)).toBeGreaterThan(0);
    expect(at(600)).toBeCloseTo(1, 6);
    expect(at(150)).toBeLessThan(at(300));
  });

  it('stops rather than pass through the ball it is following', () => {
    const p = predictShot(
      world(
        { id: 'cue', position: vec(100, 250), radius: R, kind: 'cue' },
        ball('a', 400, 250),
        ball('b', 700, 250)
      ),
      // Soft, so the cue ball has finished sliding by the time it arrives and
      // is genuinely following. At full power it would still be stunned here.
      { direction: vec(1, 0), power: 0.4 },
      { maxDepth: 0 }
    );
    expect(p.root.impact!.rollFraction).toBeCloseTo(1, 6);
    // 'screened' is the analytic engine declining to guess what happens when one
    // ball trails another. The simulation just runs them, so it never needs to.
    expect(p.root.termination).toBe('stopped');
    // 'b' is straight ahead but 'a' is between, moving faster: only one contact.
    expect(p.ballContacts).toHaveLength(1);
    expect(p.ballContacts[0].targetId).toBe('a');
  });

  it('records every ball a following cue ball goes on to strike', () => {
    // Cut 'a' aside, then carry on into 'b' well off the first line.
    const p = predictShot(
      world(
        { id: 'cue', position: vec(100, 250), radius: R, kind: 'cue' },
        ball('a', 400, 250 - 1.4 * R),
        ball('b', 700, 250)
      ),
      // Soft, so the cue ball has finished sliding by the time it arrives and
      // is genuinely following. At full power it would still be stunned here.
      { direction: vec(1, 0), power: 0.6 },
      { maxDepth: 0 }
    );
    // Whether the cue ball reaches a second ball is now the physics' answer
    // rather than the fixture's assumption — it leaves on the tangent and then
    // curves, so it does not simply carry on down the old line. What this holds
    // to is that every impact it *does* make is recorded, in order.
    expect(p.root.impacts.length).toBeGreaterThanOrEqual(1);
    expect(p.root.impacts).toEqual(
      p.ballContacts.filter((c) => c.sourceId === 'cue')
    );
    // `impact` stays the first one: that is what the cut angle describes.
    expect(p.root.impact!.targetId).toBe('a');
    expect(p.root.impacts.map((c) => c.targetId)).toEqual(['a']);
    expect(p.ballContacts).toHaveLength(1);
    expect(p.ballContacts).toHaveLength(1);
  });
});
