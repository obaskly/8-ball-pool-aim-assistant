/**
 * 8 Ball Pool's table, in the game's own coordinates.
 *
 * Transcribed from PoolPredictor's `TableProperties.cpp`. The origin is the
 * centre spot, x runs along the length, and **y runs up** — the opposite of
 * screen y, which is why everything crossing this boundary gets flipped.
 *
 * The cushions are not a rectangle. They are a 46-point closed polygon with a
 * real mouth cut at each pocket, and the game bounces balls off the individual
 * jaw *points* as well as off the faces. That is what makes a ball rattle in a
 * jaw instead of reflecting cleanly, and it is why a rectangle model quietly
 * predicts a clean rebound where the real table would drop the ball or spit it
 * back out at an angle no mirror could produce.
 */

import { POCKET_RADIUS_CM, TABLE_WIDTH_CM } from './gamePhysics';
import type { Rect } from './types';

export interface SimPoint {
  x: number;
  y: number;
}

/** Pocket centres, cm, y up. Corners sit outside the cushion lines. */
export const POCKETS_CM: readonly SimPoint[] = [
  { x: -130.8, y: -67.3 },
  { x: 0, y: -72 },
  { x: 130.8, y: -67.3 },
  { x: 130.8, y: 67.3 },
  { x: 0, y: 72 },
  { x: -130.8, y: 67.3 },
];

/** Which pocket is which, for reporting a pot. */
export const POCKET_KINDS: readonly ('corner' | 'side')[] = [
  'corner',
  'side',
  'corner',
  'corner',
  'side',
  'corner',
];

/**
 * The cushion polygon, cm, y up, wound so that `(dy, -dx)` points into the
 * playfield — which is the winding the game's own line test assumes.
 */
export const TABLE_SHAPE_CM: readonly SimPoint[] = [
  { x: -127, y: 53.5 },
  { x: -136.9, y: 64.1 },
  { x: -138.2, y: 69.2 },
  { x: -136.7, y: 73.2 },
  { x: -132.7, y: 74.7 },
  { x: -127.6, y: 73.4 },
  { x: -117, y: 63.5 },
  { x: -7.8, y: 63.5 },
  { x: -6.1, y: 68.6 },
  { x: -5.7, y: 72.7 },
  { x: -3.7, y: 75.4 },
  { x: 0, y: 76.7 },
  { x: 3.7, y: 75.4 },
  { x: 5.7, y: 72.7 },
  { x: 6.1, y: 68.6 },
  { x: 7.8, y: 63.5 },
  { x: 117, y: 63.5 },
  { x: 127.6, y: 73.4 },
  { x: 132.7, y: 74.7 },
  { x: 136.7, y: 73.2 },
  { x: 138.2, y: 69.2 },
  { x: 136.9, y: 64.1 },
  { x: 127, y: 53.5 },
  { x: 127, y: -53.5 },
  { x: 136.9, y: -64.1 },
  { x: 138.2, y: -69.2 },
  { x: 136.7, y: -73.2 },
  { x: 132.7, y: -74.7 },
  { x: 127.6, y: -73.4 },
  { x: 117, y: -63.5 },
  { x: 7.8, y: -63.5 },
  { x: 6.1, y: -68.6 },
  { x: 5.7, y: -72.7 },
  { x: 3.7, y: -75.4 },
  { x: 0, y: -76.7 },
  { x: -3.7, y: -75.4 },
  { x: -5.7, y: -72.7 },
  { x: -6.1, y: -68.6 },
  { x: -7.8, y: -63.5 },
  { x: -117, y: -63.5 },
  { x: -127.6, y: -73.4 },
  { x: -132.7, y: -74.7 },
  { x: -136.7, y: -73.2 },
  { x: -138.2, y: -69.2 },
  { x: -136.9, y: -64.1 },
  { x: -127, y: -53.5 },
];

/**
 * Maps between the screen pixels our vision works in and the centimetres the
 * game's physics works in.
 *
 * The scale comes from the table's width alone, and the height is then *implied*
 * rather than measured. That is deliberate. The game's table is exactly 2:1, our
 * cloth measurement came out at 1.9262, and taking both measurements at face
 * value would stretch y against x by 3.8% — which tilts every angle we predict.
 * Trusting one axis and deriving the other keeps the mapping square.
 */
export interface TableMapping {
  /** Pixels per centimetre. */
  scale: number;
  /** Playfield centre, in pixels. */
  cx: number;
  cy: number;
}

export function mappingFor(playfield: Rect): TableMapping {
  const width = playfield.right - playfield.left;
  return {
    scale: width / TABLE_WIDTH_CM,
    cx: (playfield.left + playfield.right) / 2,
    cy: (playfield.top + playfield.bottom) / 2,
  };
}

/** Screen pixels -> game centimetres. Flips y, which points the other way. */
export function toSim(p: { x: number; y: number }, m: TableMapping): SimPoint {
  return { x: (p.x - m.cx) / m.scale, y: -(p.y - m.cy) / m.scale };
}

/** Game centimetres -> screen pixels. */
export function toScreen(p: SimPoint, m: TableMapping): { x: number; y: number } {
  return { x: m.cx + p.x * m.scale, y: m.cy - p.y * m.scale };
}

/** Pocket capture radius in cm — the mouth the game actually sucks balls into. */
export const POCKET_CAPTURE_CM = POCKET_RADIUS_CM;
