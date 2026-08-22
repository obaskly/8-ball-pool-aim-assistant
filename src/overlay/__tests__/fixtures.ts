import type { Ball, TableGeometry } from '../../physics/types';
import { add, fromAngle, scale, vec } from '../../physics/vec2';

/**
 * Test fixtures only. Nothing here is shipped: the app reads ball positions off
 * the screen, and these exist so the scene builder can be exercised against a
 * layout whose collision geometry is known exactly rather than eyeballed.
 */

/** First and second cut angles built into the spread layout. */
const CUT_1 = (20 * Math.PI) / 180;
const CUT_2 = (18 * Math.PI) / 180;
/** Gap between the first and second object ball, as a fraction of table width. */
const CHAIN_GAP = 0.24;

/** Scenery: well clear of every path above, so the chain stays predictable. */
const BYSTANDERS: ReadonlyArray<readonly [number, number, Ball['kind']]> = [
  [0.3, 0.16, 'stripe'],
  [0.72, 0.2, 'solid'],
  [0.33, 0.84, 'eight'],
];

/**
 * An open table, laid out *from the collision geometry*: a straight shot along
 * +x cuts the first object ball by CUT_1, and the first object ball is aimed to
 * cut the second by CUT_2. That guarantees the layout exercises a primary
 * impact, a tangent line and a secondary collision, which is the whole point of
 * the multi-ball prediction.
 *
 * A cue ball travelling along +x that meets a target offset by `dy` leaves along
 * the line of centres at asin(dy / 2r), so placing the target at
 * `2r * sin(cut)` off the shot line fixes the cut angle exactly.
 */
export function buildSpreadLayout(table: TableGeometry): Ball[] {
  const { playfield: pf, ballRadius: r } = table;
  const width = pf.right - pf.left;
  const height = pf.bottom - pf.top;
  const at = (fx: number, fy: number) =>
    vec(pf.left + width * fx, pf.top + height * fy);

  const cue = at(0.16, 0.5);

  const first = vec(pf.left + width * 0.45, cue.y + 2 * r * Math.sin(CUT_1));
  // The struck ball departs along the line of centres, which is exactly CUT_1.
  const firstDirection = fromAngle(CUT_1);
  const perpendicular = vec(-firstDirection.y, firstDirection.x);

  const second = add(
    add(first, scale(firstDirection, width * CHAIN_GAP)),
    scale(perpendicular, 2 * r * Math.sin(CUT_2))
  );

  const balls: Ball[] = [
    { id: 'cue', position: cue, radius: r, kind: 'cue' },
    { id: 'b1', position: first, radius: r, kind: 'solid' },
    { id: 'b2', position: second, radius: r, kind: 'stripe' },
  ];

  BYSTANDERS.forEach(([fx, fy, kind], i) => {
    balls.push({
      id: kind === 'eight' ? 'eight' : `b${i + 3}`,
      position: at(fx, fy),
      radius: r,
      kind,
    });
  });

  return balls;
}

/** A cue ball on its own: a shot with nothing to hit. */
export function buildCueOnlyLayout(table: TableGeometry): Ball[] {
  const { playfield: pf, ballRadius: r } = table;
  return [
    {
      id: 'cue',
      position: vec(
        pf.left + (pf.right - pf.left) * 0.25,
        (pf.top + pf.bottom) / 2
      ),
      radius: r,
      kind: 'cue',
    },
  ];
}
