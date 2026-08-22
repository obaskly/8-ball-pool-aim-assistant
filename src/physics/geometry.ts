import { Vec2, add, dot, len, normalize, scale, sub } from './vec2';
import type { Ball, Pocket, Rail, Rect, TableGeometry } from './types';

export const EPS = 1e-9;
/** Nudge used to push a contact point off a surface so the next cast re-hits it. */
export const SURFACE_EPS = 1e-6;

/**
 * Swept-circle cast: a circle of radius `movingRadius` starts at `origin` and
 * travels along unit vector `dir`. Returns the distance travelled until it
 * touches a static circle at `center` with radius `targetRadius`, or null.
 *
 * Solves |origin + t*dir - center| = R for the smaller positive root, where
 * R = movingRadius + targetRadius.
 *
 * `grazeTolerance` widens that circle for near misses only: a ray that passes
 * within it, but does not actually cross, reports the point of closest approach
 * instead of nothing. Ball centres come from a detector working on a ~16 px
 * radius, so a pixel of error is enough to turn a thin cut into a clean miss and
 * send the predicted path clear across the table. Off by default, because a
 * near miss really is a miss and only a caller holding independent evidence —
 * the measured guideline length — can tell the two apart.
 */
export function castCircle(
  origin: Vec2,
  dir: Vec2,
  center: Vec2,
  movingRadius: number,
  targetRadius: number,
  grazeTolerance = 0
): number | null {
  const R = movingRadius + targetRadius;
  const m = sub(center, origin);
  const b = dot(m, dir);
  const c = dot(m, m) - R * R;

  // Already overlapping: only report a hit if we are closing on it.
  if (c < 0) return b > 0 ? 0 : null;
  // Pointing away from the target.
  if (b <= 0) return null;

  const disc = b * b - c;
  if (disc >= 0) {
    const t = b - Math.sqrt(disc);
    return t >= 0 ? t : null;
  }

  // A clean miss. `disc = R^2 - perp^2`, so a negative one gives the closest
  // approach directly. Only balls genuinely down-table are rescued: one sitting
  // beside the cue ball is never what the shot is aimed at, and snapping to it
  // would report a contact at almost zero distance.
  if (grazeTolerance <= 0 || b < R) return null;
  return Math.sqrt(R * R - disc) <= R + grazeTolerance ? b : null;
}

/**
 * Cast a ball centre against one cushion. The centre is constrained to stay at
 * least `ballRadius` from the cushion face, so the effective plane is the face
 * offset inward by that radius.
 */
export function castRail(
  origin: Vec2,
  dir: Vec2,
  rail: Rail,
  ballRadius: number
): number | null {
  const denom = dot(dir, rail.normal);
  // Moving parallel to, or away from, this cushion.
  if (denom > -EPS) return null;

  const signedDistance = dot(sub(origin, rail.a), rail.normal);
  const t = (ballRadius - signedDistance) / denom;
  if (t < 0) return null;

  // Contact must land within the cushion's extent.
  const along = sub(rail.b, rail.a);
  const length = len(along);
  if (length < EPS) return null;
  const axis = scale(along, 1 / length);
  const hit = add(origin, scale(dir, t));
  const s = dot(sub(hit, rail.a), axis);
  if (s < -ballRadius || s > length + ballRadius) return null;

  return t;
}

/** Distance until the ball centre enters a pocket's capture circle. */
export function castPocket(
  origin: Vec2,
  dir: Vec2,
  pocket: Pocket
): number | null {
  // The ball centre (a point) against the capture circle: moving radius is 0.
  return castCircle(origin, dir, pocket.center, 0, pocket.captureRadius);
}

export function insetRect(rect: Rect, by: number): Rect {
  return {
    left: rect.left + by,
    top: rect.top + by,
    right: rect.right - by,
    bottom: rect.bottom - by,
  };
}

export function clampToRect(p: Vec2, rect: Rect): Vec2 {
  return {
    x: Math.min(Math.max(p.x, rect.left), rect.right),
    y: Math.min(Math.max(p.y, rect.top), rect.bottom),
  };
}

export function rectContains(p: Vec2, rect: Rect): boolean {
  return (
    p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom
  );
}

/**
 * Build the four cushions of a rectangular table. Screen coordinates: +y is down,
 * so the top cushion's inward normal points down.
 */
export function railsForRect(playfield: Rect): Rail[] {
  const { left, top, right, bottom } = playfield;
  return [
    { id: 'top', a: { x: left, y: top }, b: { x: right, y: top }, normal: { x: 0, y: 1 } },
    { id: 'bottom', a: { x: left, y: bottom }, b: { x: right, y: bottom }, normal: { x: 0, y: -1 } },
    { id: 'left', a: { x: left, y: top }, b: { x: left, y: bottom }, normal: { x: 1, y: 0 } },
    { id: 'right', a: { x: right, y: top }, b: { x: right, y: bottom }, normal: { x: -1, y: 0 } },
  ];
}

export interface RectTableSpec {
  playfield: Rect;
  ballRadius: number;
  cornerCaptureRadius: number;
  sideCaptureRadius: number;
}

/** Standard six-pocket rectangular table: four corners plus two side pockets. */
export function createRectTable(spec: RectTableSpec): TableGeometry {
  const { playfield, ballRadius, cornerCaptureRadius, sideCaptureRadius } = spec;
  const midX = (playfield.left + playfield.right) / 2;

  const pockets: Pocket[] = [
    { id: 'top-left', center: { x: playfield.left, y: playfield.top }, captureRadius: cornerCaptureRadius, kind: 'corner' },
    { id: 'top-center', center: { x: midX, y: playfield.top }, captureRadius: sideCaptureRadius, kind: 'side' },
    { id: 'top-right', center: { x: playfield.right, y: playfield.top }, captureRadius: cornerCaptureRadius, kind: 'corner' },
    { id: 'bottom-left', center: { x: playfield.left, y: playfield.bottom }, captureRadius: cornerCaptureRadius, kind: 'corner' },
    { id: 'bottom-center', center: { x: midX, y: playfield.bottom }, captureRadius: sideCaptureRadius, kind: 'side' },
    { id: 'bottom-right', center: { x: playfield.right, y: playfield.bottom }, captureRadius: cornerCaptureRadius, kind: 'corner' },
  ];

  return { playfield, ballRadius, rails: railsForRect(playfield), pockets };
}

/** True when two balls overlap, which usually means a bad detection frame. */
export function ballsOverlap(a: Ball, b: Ball): boolean {
  const r = a.radius + b.radius;
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  return dx * dx + dy * dy < r * r - EPS;
}

/**
 * Direction the cue ball must travel for `target` to be sent toward `pocket`.
 * This is the classic ghost-ball aim solve: place a phantom cue ball touching
 * the target on the far side from the pocket, and aim at its centre.
 *
 * Returns null when the cue ball is already past the ghost position, i.e. the
 * cut is physically impossible from where the cue ball sits.
 */
export function solveGhostBall(
  cue: Vec2,
  target: Vec2,
  pocket: Vec2,
  ballRadius: number
): { ghostCenter: Vec2; aimDirection: Vec2; cutAngle: number } | null {
  const toPocket = normalize(sub(pocket, target));
  if (toPocket.x === 0 && toPocket.y === 0) return null;

  const ghostCenter = sub(target, scale(toPocket, 2 * ballRadius));
  const toGhost = sub(ghostCenter, cue);
  const d = len(toGhost);
  if (d < EPS) return null;

  const aimDirection = scale(toGhost, 1 / d);
  const cosCut = dot(aimDirection, toPocket);
  // Cut angles at or beyond 90 degrees cannot transfer forward motion.
  if (cosCut <= EPS) return null;

  return {
    ghostCenter,
    aimDirection,
    cutAngle: Math.acos(Math.min(1, Math.max(-1, cosCut))),
  };
}
