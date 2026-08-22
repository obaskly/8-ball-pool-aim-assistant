import { describe, expect, it } from 'vitest';

import {
  REFERENCE_RESOLUTION,
  buildReferenceTable,
} from '../../calibration/tableProfile';
import { predictShot } from '../../physics/engine';
import type { World } from '../../physics/types';
import { dist, vec } from '../../physics/vec2';
import { DEFAULT_THEME } from '../theme';
import { buildScene } from '../scene';
import { buildCueOnlyLayout, buildSpreadLayout } from './fixtures';

const table = buildReferenceTable();

const spread: World = { table, balls: buildSpreadLayout(table) };
// A controlled shot, not a break. At power 1 the cue ball now carries 76 table
// lengths of energy — realistic, but it careens on and strikes b2 itself before
// b1 gets there, which the sequential resolution then hides from b1.
const straightShot = { direction: vec(1, 0), power: 0.3 };

describe('the spread fixture', () => {
  it('is built around the cut angles it advertises', () => {
    const p = predictShot(spread, straightShot, { maxDepth: 2 });
    expect(p.ballContacts.length).toBeGreaterThanOrEqual(2);

    // Straight shot -> 20 degree cut on b1 -> b1 cuts b2 by 18 degrees.
    expect(p.root.impact?.targetId).toBe('b1');
    expect(p.root.impact!.cutAngle * (180 / Math.PI)).toBeCloseTo(20, 4);

    const b1 = p.root.children.find((c) => c.ballId === 'b1');
    expect(b1?.impact?.targetId).toBe('b2');
    expect(b1!.impact!.cutAngle * (180 / Math.PI)).toBeCloseTo(18, 4);
  });

  it('never overlaps two balls', () => {
    for (let i = 0; i < spread.balls.length; i++) {
      for (let j = i + 1; j < spread.balls.length; j++) {
        const gap = dist(spread.balls[i].position, spread.balls[j].position);
        expect(gap).toBeGreaterThan(
          spread.balls[i].radius + spread.balls[j].radius
        );
      }
    }
  });

  it('leaves the cue-only layout with nothing to hit', () => {
    const w: World = { table, balls: buildCueOnlyLayout(table) };
    const p = predictShot(w, straightShot);
    expect(p.ballContacts).toHaveLength(0);
  });
});

describe('buildScene', () => {
  const prediction = predictShot(spread, straightShot, { maxDepth: 2 });

  it('emits one polyline per contiguous run of the same role', () => {
    const scene = buildScene(spread, prediction);
    const roles = new Set(prediction.segments.map((s) => s.role));
    expect(scene.polylines!.length).toBeGreaterThanOrEqual(roles.size);

    for (const line of scene.polylines!) {
      expect(line.points.length % 2).toBe(0);
      expect(line.points.length).toBeGreaterThanOrEqual(4);
      expect(line.points.every(Number.isFinite)).toBe(true);
    }
  });

  it('keeps every drawn point on screen', () => {
    const scene = buildScene(spread, prediction, { showTable: true, showBalls: true });
    for (const line of scene.polylines!) {
      for (let i = 0; i < line.points.length; i += 2) {
        expect(line.points[i]).toBeGreaterThanOrEqual(-1);
        expect(line.points[i]).toBeLessThanOrEqual(REFERENCE_RESOLUTION.width + 1);
        expect(line.points[i + 1]).toBeGreaterThanOrEqual(-1);
        expect(line.points[i + 1]).toBeLessThanOrEqual(REFERENCE_RESOLUTION.height + 1);
      }
    }
  });

  it('dashes the tangent line and leaves the others solid', () => {
    const scene = buildScene(spread, prediction);
    for (const line of scene.polylines!) {
      const dashed = (line.dash ?? 0) > 0;
      expect(dashed).toBe(line.color === DEFAULT_THEME.tangent);
    }
  });

  it('trims the head of the primary line by primaryGap and nothing else', () => {
    const gap = 200;
    const plain = buildScene(spread, prediction);
    const trimmed = buildScene(spread, prediction, { primaryGap: gap });

    const primaryOf = (scene: typeof plain) =>
      scene.polylines!.find((l) => l.color === DEFAULT_THEME.primary)!;

    const before = primaryOf(plain);
    const after = primaryOf(trimmed);

    // Same tail, later start, along the same line.
    expect(after.points.slice(2)).toEqual(before.points.slice(2));
    expect(
      dist(
        vec(before.points[0], before.points[1]),
        vec(after.points[0], after.points[1])
      )
    ).toBeCloseTo(gap, 6);

    // The other roles are untouched.
    const others = (scene: typeof plain) =>
      scene.polylines!.filter((l) => l.color !== DEFAULT_THEME.primary);
    expect(others(trimmed)).toEqual(others(plain));
  });

  it('drops the primary line entirely when the gap outruns it', () => {
    const scene = buildScene(spread, prediction, { primaryGap: 100000 });
    expect(
      scene.polylines!.some((l) => l.color === DEFAULT_THEME.primary)
    ).toBe(false);
    // The rest of the prediction still renders.
    expect(scene.polylines!.length).toBeGreaterThan(0);
  });

  it('fades each generation of struck ball', () => {
    const scene = buildScene(spread, prediction);
    const alphas = scene.polylines!.map((l) => l.alpha ?? 1);
    expect(Math.min(...alphas)).toBeLessThan(1);
    expect(Math.min(...alphas)).toBeGreaterThan(0);
  });

  it('draws the ghost ball at the contact position, one diameter from the target', () => {
    const scene = buildScene(spread, prediction, { showGhostBall: true });
    const contact = prediction.primaryContact!;
    const target = spread.balls.find((b) => b.id === contact.targetId)!;
    expect(dist(contact.ghostBall, target.position)).toBeCloseTo(target.radius * 2, 6);

    const ghost = scene.circles!.find(
      (c) =>
        Math.abs(c.x - contact.ghostBall.x) < 1e-6 &&
        Math.abs(c.y - contact.ghostBall.y) < 1e-6
    );
    expect(ghost).toBeDefined();
    expect(ghost!.radius).toBeCloseTo(table.ballRadius, 6);
  });

  it('adds table and ball overlays only when asked', () => {
    const bare = buildScene(spread, prediction, { showTable: false, showBalls: false });
    const full = buildScene(spread, prediction, { showTable: true, showBalls: true });
    expect(full.circles!.length).toBeGreaterThan(bare.circles!.length);
    expect(full.polylines!.length).toBe(bare.polylines!.length + 1);
  });

  it('labels the cut angle only when asked', () => {
    expect(buildScene(spread, prediction).labels).toHaveLength(0);
    expect(
      buildScene(spread, prediction, { showCutAngle: true }).labels!.length
    ).toBe(1);
  });

  it('produces an empty scene for a shot into nothing', () => {
    const w: World = { table, balls: buildCueOnlyLayout(table) };
    const p = predictShot(w, { direction: vec(0, 0), power: 1 });
    const scene = buildScene(w, p);
    expect(scene.polylines).toHaveLength(0);
    expect(scene.circles).toHaveLength(0);
  });
});
