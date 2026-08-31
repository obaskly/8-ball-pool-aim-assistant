import {
  BALL_RADIUS_TO_WIDTH_EXACT,
  TABLE_ASPECT_EXACT,
} from '../physics/gamePhysics';
import { createRectTable } from '../physics/geometry';
import type { Rect, TableGeometry } from '../physics/types';

/**
 * Table geometry measured from the reference frames in ./docs/reference-frames.
 *
 * Method: the cloth was segmented by its colour (see REFERENCE_CLOTH),
 * then the cushion faces were taken as the median first/last cloth pixel across
 * every scanline carrying more than an eighth of a line of cloth. The median is
 * what makes it exact: pocket mouths and balls resting on a cushion only disturb
 * a minority of the lines. The resulting rectangle was pixel-for-pixel identical
 * across all 8 frames, so these numbers carry no measurement spread at all.
 *
 * Measured on the 1600x738 frames, scaled to the 2340x1080 device they came from:
 *   playfield      (412, 227) -> (1926, 1013)      1514 x 786
 *   aspect ratio   1.9262
 *   ball radius    23.4 px
 *   pocket mouths  38 px along each face at the corners, 47 px at the sides
 *
 * The ball radius is the distance transform's depth at a ball's centre, which is
 * the radius by construction, and it read 15.5-16.1 px on the 1600 px frames over
 * every isolated ball in all 8 - a spread of half a pixel across ~100 balls.
 * Blob-area measurements are biased either way: a bright-core threshold catches
 * only the specular region, and a not-cloth mask swallows the drop shadow.
 */

export const REFERENCE_RESOLUTION = { width: 2340, height: 1080 } as const;

/**
 * The cloth rectangle in reference pixels — cushion *cloth*, not cushion face.
 *
 * The distinction was missed originally and is the reason the numbers below did
 * not add up. What the segmentation finds is every pixel of felt, and the game
 * covers the sloping face of each cushion in the same felt as the bed, so the
 * rectangle runs from the top of one cushion slope to the top of the opposite
 * one and overshoots the playing surface by the slope's width on all four sides.
 * See [playingSurface], which takes it back off.
 */
export const REFERENCE_PLAYFIELD: Rect = {
  left: 412,
  top: 227,
  right: 1926,
  bottom: 1013,
};

export const REFERENCE_PLAYFIELD_SIZE = {
  width: REFERENCE_PLAYFIELD.right - REFERENCE_PLAYFIELD.left, // 1514
  height: REFERENCE_PLAYFIELD.bottom - REFERENCE_PLAYFIELD.top, // 786
} as const;

/**
 * Widest cushion slope believed, as a fraction of the cloth's width. A sanity
 * clamp on [playingSurface], not a calibration: the real slope measures 0.020.
 */
const MAX_CUSHION_SLOPE_FRACTION = 0.05;

/**
 * The playing surface inside a detected cloth rectangle.
 *
 * The cloth runs over the cushion slopes as well as the bed, so what the
 * detector measures is the playing surface plus one slope width on every side.
 * That inset is what makes the measured rectangle come out at 1.92 when the
 * game's table is exactly 2:1 — and since it is the *same* inset on all four
 * sides, the two facts together determine it with nothing left to calibrate:
 *
 *   W = Wt + 2c,  H = Ht + 2c,  Wt = 2 * Ht   =>   c = H - W / 2
 *
 * Measured against three independent things on real captures, at a cloth
 * rectangle of 1138 x 592 which gives c = 23 px:
 *
 *  - the head-string line the game draws at a quarter of the table's length
 *    lands at 603.0 px predicted against 603.1 measured, where taking the cloth
 *    rectangle as the playing surface predicts 591.5 — out by 11.6 px;
 *  - the ball radius comes out at 16.34 px against 16.2-16.5 measured across
 *    fourteen balls, where the cloth rectangle gives 17.0;
 *  - a brightness profile straight down through the top rail puts the cushion
 *    nose 23 px inside the top of the cloth.
 *
 * Uncorrected, every cushion bounce was predicted 11 px (long rails) to 23 px
 * (short rails) past the rail that produced it, and every distance in the
 * simulation ran 4.2% long.
 */
export function playingSurface(cloth: Rect): Rect {
  const width = cloth.right - cloth.left;
  const height = cloth.bottom - cloth.top;
  const surfaceHeight = (width - height) / (TABLE_ASPECT_EXACT - 1);
  const inset = Math.min(
    Math.max((height - surfaceHeight) / 2, 0),
    width * MAX_CUSHION_SLOPE_FRACTION
  );
  return {
    left: cloth.left + inset,
    top: cloth.top + inset,
    right: cloth.right - inset,
    bottom: cloth.bottom - inset,
  };
}

/** Cushion faces in reference pixels: 1456 x 728, exactly 2:1. */
export const REFERENCE_SURFACE: Rect = playingSurface(REFERENCE_PLAYFIELD);

export const REFERENCE_SURFACE_SIZE = {
  width: REFERENCE_SURFACE.right - REFERENCE_SURFACE.left, // 1456
  height: REFERENCE_SURFACE.bottom - REFERENCE_SURFACE.top, // 728
} as const;

export const REFERENCE_BALL_RADIUS = 23.4;

/** Pocket mouth widths measured along the cushion faces, in reference pixels. */
export const REFERENCE_POCKET_MOUTH = { corner: 56, side: 69 } as const;

/**
 * Capture radii: a ball whose centre comes within this distance of the pocket
 * centre drops. Set just above the mouth half-width so a ball rolling along a
 * cushion into a corner is captured, which matches how the game behaves.
 */
export const REFERENCE_CAPTURE_RADIUS = { corner: 59, side: 38 } as const;

/** Ratios are resolution independent and are the numbers worth carrying around. */
/**
 * Ball radius over playing width, from the game's own geometry rather than our
 * cloth measurement.
 *
 * Every ratio here is against the *playing* width — [REFERENCE_SURFACE_SIZE] —
 * so it must be applied to a rectangle that has been through [playingSurface],
 * never to the cloth rectangle straight off the detector.
 *
 * The game's figure is 3.800475 / 254 = 0.0149625, which on the reference frames
 * is 21.8 px against the 23.4 measured. The difference is the ball's own dark
 * outline and drop shadow, which no not-cloth measurement can avoid counting;
 * the physics places every contact at the true radius, and over a baseline of
 * one diameter a pixel and a half of radius error is nearly three degrees of
 * where the object ball leaves.
 */
export const BALL_RADIUS_TO_TABLE_WIDTH = BALL_RADIUS_TO_WIDTH_EXACT;
export const CORNER_CAPTURE_TO_TABLE_WIDTH =
  REFERENCE_CAPTURE_RADIUS.corner / REFERENCE_SURFACE_SIZE.width; // 0.040522
export const SIDE_CAPTURE_TO_TABLE_WIDTH =
  REFERENCE_CAPTURE_RADIUS.side / REFERENCE_SURFACE_SIZE.width; // 0.026099
/**
 * Exactly 2:1 — the playing surface, after [playingSurface] has taken the
 * cushion slopes off. The cloth rectangle the detector reports measures 1.9262.
 */
export const TABLE_ASPECT_RATIO = TABLE_ASPECT_EXACT;

/** What the cloth rectangle itself measures, slopes included. */
export const CLOTH_ASPECT_RATIO =
  REFERENCE_PLAYFIELD_SIZE.width / REFERENCE_PLAYFIELD_SIZE.height; // 1.9262

/**
 * What the reference frames' cloth measured, kept as the record of where the
 * geometry above came from.
 *
 * Nothing reads it any more. The analyser used to test for exactly this colour,
 * which worked on the table it was measured on and found no table at all on the
 * other skins the game sells — blue, teal, green, brown and a near-black one.
 * It now learns the cloth off the frame instead; see `ClothModel` in
 * `TableAnalyzer.kt`. This is the sample it was validated against.
 *
 * The felt here is a blue-cyan carrying a strong radial gradient, running from
 * about (19,111,152) at the rails to (107,192,213) under the centre light.
 */
export const REFERENCE_CLOTH = {
  rails: { r: 19, g: 111, b: 152 },
  centre: { r: 107, g: 192, b: 213 },
  /** Below this fraction of the frame, treat the table as occluded. */
  minClothFraction: 0.08,
} as const;

/** Playfield expressed as a fraction of the screen, for rescaling. */
export const PLAYFIELD_FRACTION = {
  left: REFERENCE_PLAYFIELD.left / REFERENCE_RESOLUTION.width, // 0.160256
  top: REFERENCE_PLAYFIELD.top / REFERENCE_RESOLUTION.height, // 0.210185
  right: REFERENCE_PLAYFIELD.right / REFERENCE_RESOLUTION.width, // 0.838889
  bottom: REFERENCE_PLAYFIELD.bottom / REFERENCE_RESOLUTION.height, // 0.937963
} as const;

/** User-tunable nudges applied on top of the measured profile. */
export interface CalibrationAdjustment {
  offsetX: number;
  offsetY: number;
  /** Multiplies the playfield size about its centre. */
  scale: number;
  ballRadiusScale: number;
  captureRadiusScale: number;
}

export const IDENTITY_ADJUSTMENT: CalibrationAdjustment = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  ballRadiusScale: 1,
  captureRadiusScale: 1,
};

/**
 * Build a table for a given screen size.
 *
 * The playfield is placed by screen fraction, which is exact at the reference
 * resolution and a good starting point elsewhere. Devices with a different aspect
 * ratio will need the offset/scale nudges from the calibration panel, because the
 * game letterboxes rather than stretching.
 */
export function buildTable(
  screenWidth: number,
  screenHeight: number,
  adjust: CalibrationAdjustment = IDENTITY_ADJUSTMENT
): TableGeometry {
  // The fractions describe the cloth, so the slopes come off here exactly as
  // they do for a measured frame — otherwise the preview table and the live one
  // would be different sizes.
  const base: Rect = playingSurface({
    left: PLAYFIELD_FRACTION.left * screenWidth,
    top: PLAYFIELD_FRACTION.top * screenHeight,
    right: PLAYFIELD_FRACTION.right * screenWidth,
    bottom: PLAYFIELD_FRACTION.bottom * screenHeight,
  });

  const cx = (base.left + base.right) / 2 + adjust.offsetX;
  const cy = (base.top + base.bottom) / 2 + adjust.offsetY;
  const halfW = ((base.right - base.left) / 2) * adjust.scale;
  const halfH = ((base.bottom - base.top) / 2) * adjust.scale;

  const playfield: Rect = {
    left: cx - halfW,
    top: cy - halfH,
    right: cx + halfW,
    bottom: cy + halfH,
  };

  const width = playfield.right - playfield.left;

  return createRectTable({
    playfield,
    ballRadius: width * BALL_RADIUS_TO_TABLE_WIDTH * adjust.ballRadiusScale,
    cornerCaptureRadius:
      width * CORNER_CAPTURE_TO_TABLE_WIDTH * adjust.captureRadiusScale,
    sideCaptureRadius:
      width * SIDE_CAPTURE_TO_TABLE_WIDTH * adjust.captureRadiusScale,
  });
}

/** The exact reference table, for tests and for the on-screen preview. */
export function buildReferenceTable(
  adjust: CalibrationAdjustment = IDENTITY_ADJUSTMENT
): TableGeometry {
  return buildTable(
    REFERENCE_RESOLUTION.width,
    REFERENCE_RESOLUTION.height,
    adjust
  );
}
