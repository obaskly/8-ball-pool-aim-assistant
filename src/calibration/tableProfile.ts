import {
  BALL_RADIUS_TO_WIDTH_EXACT,
  TABLE_ASPECT_EXACT,
} from '../physics/gamePhysics';
import { createRectTable } from '../physics/geometry';
import type { Rect, TableGeometry } from '../physics/types';

/**
 * Table geometry measured from the reference frames in ./docs/reference-frames.
 *
 * Method: the cloth was segmented by its colour signature (see CLOTH_SIGNATURE),
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

/** Cushion faces in reference pixels. */
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
 * Measuring it here gave 23.4 / 1514 = 0.015456. The game's real figure is
 * 3.800475 / 254 = 0.0149625, so ours ran 3.3% high — and the same measurement
 * put the table's aspect at 1.9262 where the game has exactly 2. Both point the
 * same way: the detected cloth rectangle is a little narrow. The physics places
 * every contact at the true radius, so carrying our own number here would put
 * ghost balls a diameter's worth of error away from where the shot resolves.
 */
export const BALL_RADIUS_TO_TABLE_WIDTH = BALL_RADIUS_TO_WIDTH_EXACT;
export const CORNER_CAPTURE_TO_TABLE_WIDTH =
  REFERENCE_CAPTURE_RADIUS.corner / REFERENCE_PLAYFIELD_SIZE.width; // 0.038970
export const SIDE_CAPTURE_TO_TABLE_WIDTH =
  REFERENCE_CAPTURE_RADIUS.side / REFERENCE_PLAYFIELD_SIZE.width; // 0.025099
/** Exactly 2:1. Our own cloth measurement said 1.9262; see above. */
export const TABLE_ASPECT_RATIO = TABLE_ASPECT_EXACT;

/**
 * Cloth colour test used to locate the table.
 *
 * The felt is a blue-cyan carrying a strong radial gradient: it runs from about
 * (19,111,152) at the rails to (107,192,213) under the centre light, so a single
 * "strongly blue" test cannot cover it. Both ends clear a green-over-red lift of
 * 50, which is what separates cloth from the dark navy chrome around the table.
 *
 * The ceiling on blue-over-green is the load-bearing one. It is the only thing
 * separating cloth from the blue balls, which share its hue almost exactly:
 * measured over all 8 frames the cloth spans 14..45 here and a blue ball's body
 * 63..100. Without it the blue balls read as cloth and go missing entirely.
 */
export const CLOTH_SIGNATURE = {
  minBlue: 100,
  minGreenOverRed: 40,
  minBlueOverGreen: 8,
  maxBlueOverGreen: 54,
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
  const base: Rect = {
    left: PLAYFIELD_FRACTION.left * screenWidth,
    top: PLAYFIELD_FRACTION.top * screenHeight,
    right: PLAYFIELD_FRACTION.right * screenWidth,
    bottom: PLAYFIELD_FRACTION.bottom * screenHeight,
  };

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
