import { describe, it } from 'vitest';
import { simulate, type SimBall } from '../physics/sim';
import { TABLE_SHAPE_CM } from '../physics/table8bp';

function ball(id: string, x: number, y: number, vx = 0, vy = 0): SimBall {
  return {
    id,
    position: { x, y },
    velocity: { x: vx, y: vy },
    spin: { x: 0, y: 0, z: 0 },
    onTable: true,
    pocketIndex: null,
    path: [],
    speeds: [],
    pinned: 0,
    firstImpactAt: null,
  } as unknown as SimBall;
}

describe('sim pathology', () => {
  it('ball wedged at a jaw point inside the suction field', () => {
    // Corner pocket at (-130.8, -67.3); jaw points near (-127, -53.5) etc.
    // Park the cue ball touching a jaw vertex inside POCKET_RADIUS and push it in.
    const jaw = TABLE_SHAPE_CM[0]; // (-127, 53.5)
    const b = ball('cue', jaw.x + 3.81, jaw.y + 3.81, -30, -30);
    const t0 = Date.now();
    const r = simulate([b]);
    console.log(`  jaw-wedge: ${Date.now() - t0} ms, ticks=${r.ticks}, path=${b.path.length}`);
  }, 20000);

  it('full rack break, all balls', () => {
    const balls: SimBall[] = [ball('cue', -80, 0, 880, 1)];
    let n = 0;
    for (let row = 0; row < 5; row++) {
      for (let k = 0; k <= row; k++) {
        balls.push(ball(`b${n++}`, 60 + row * 6.6, (k - row / 2) * 7.7));
      }
    }
    const t0 = Date.now();
    const r = simulate(balls);
    console.log(`  break: ${Date.now() - t0} ms, ticks=${r.ticks}`);
  }, 20000);

  it('ball orbiting the pocket mouth', () => {
    // Just outside capture, inside suction, moving tangentially: the pull is a
    // spring with no damping, so this is the orbit case.
    const b = ball('cue', -130.8 + 6.5, -67.3, 0, 55);
    const t0 = Date.now();
    const r = simulate([b]);
    console.log(`  orbit: ${Date.now() - t0} ms, ticks=${r.ticks}, potted=${r.pots.length}`);
  }, 20000);
});
