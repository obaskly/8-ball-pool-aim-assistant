/** Minimal 2D vector math. All functions are pure and allocation-light. */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 2D scalar cross product (z of the 3D cross). Sign gives turn direction. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const len2 = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist2 = (a: Vec2, b: Vec2): number => len2(sub(a, b));
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Returns a zero vector if the input is degenerate, so callers never get NaN. */
export function normalize(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  if (l < 1e-12) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

/** Left-hand perpendicular. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function rotate(a: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);

export const fromAngle = (radians: number, length = 1): Vec2 => ({
  x: Math.cos(radians) * length,
  y: Math.sin(radians) * length,
});

/**
 * Mirror `v` about the plane whose unit normal is `n`.
 * Pure geometric reflection: the angle of incidence equals the angle of reflection.
 */
export const mirror = (v: Vec2, n: Vec2): Vec2 => sub(v, scale(n, 2 * dot(v, n)));

/** Component of `v` along unit vector `n`. */
export const project = (v: Vec2, n: Vec2): Vec2 => scale(n, dot(v, n));

/** Component of `v` perpendicular to unit vector `n`. */
export const reject = (v: Vec2, n: Vec2): Vec2 => sub(v, project(v, n));

/** Unsigned angle between two vectors, in radians, clamped against FP drift. */
export function angleBetween(a: Vec2, b: Vec2): number {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  const c = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)));
  return Math.acos(c);
}
