/**
 * All coordinates in this file are **physical screen pixels**, with the origin at
 * the top-left of the display including the area behind the status bar and
 * cutout. That is the coordinate space the overlay window covers, and the space
 * `getDisplayMetrics()` reports, so physics output can be handed over untouched.
 */

export type OverlayTouchPhase = 'down' | 'move' | 'up' | 'cancel';

export type OverlayStateChangeEvent = {
  visible: boolean;
};

export type OverlayTouchEvent = {
  phase: OverlayTouchPhase;
  x: number;
  y: number;
};

/**
 * A control on the floating panel was used.
 *
 * `key` is either a setting the panel mirrors or a one-shot action. JS owns
 * every value: the panel reports the tap and waits to be told the new state,
 * which is what stops the two copies of the settings from drifting apart.
 */
export type OverlayPanelChangeEvent = {
  key:
    | keyof OverlayPanelSettings
    | 'relearnCloth'
    | 'stopCapture'
    /** The panel was opened by the chip or closed by its minimise button. */
    | 'panelVisible';
  value: number | string | boolean;
};

/** The settings the floating panel mirrors. */
export interface OverlayPanelSettings {
  powerSource: 'auto' | 'manual';
  /** 0.05..1. */
  power: number;
  cueBallSpin: 'auto' | 'stun' | 'natural';
  maxDepth: number;
  maxCushions: number;
  showTable: boolean;
  showBalls: boolean;
  showCutAngle: boolean;
  interactive: boolean;
}

/** Everything the floating panel shows: the settings plus a status readout. */
export interface OverlayPanelState extends OverlayPanelSettings {
  /** One line for what the detector is doing. */
  status: string;
  /** Frame rate, cost and ball count. */
  detail: string;
  /** The cloth colour being matched, as `#RRGGBB`. */
  clothColor: string | null;
}

export type OverlayNativeModuleEvents = {
  onOverlayStateChange: (event: OverlayStateChangeEvent) => void;
  onOverlayTouch: (event: OverlayTouchEvent) => void;
  onFrameAnalyzed: (event: FrameAnalysis) => void;
  onCaptureStateChange: (event: CaptureStateChangeEvent) => void;
  /**
   * The app was asked for from the overlay — the "Open the full panel" button.
   * Native brings the activity to the front on its own; this only exists so JS
   * can react (refresh a reading, say).
   */
  onBubbleTap: (event: Record<string, never>) => void;
  /** A control on the floating settings panel was used. */
  onPanelChange: (event: OverlayPanelChangeEvent) => void;
};

/** Colours are `#RRGGBB` or `#AARRGGBB`. */
export type OverlayColor = string;

export interface OverlayPolyline {
  /** Flattened `[x0, y0, x1, y1, ...]`. Fewer than two points is dropped. */
  points: number[];
  color?: OverlayColor;
  width?: number;
  /** Dash length in pixels. Omit or pass 0 for a solid line. */
  dash?: number;
  /** Multiplies the colour's own alpha. */
  alpha?: number;
}

export interface OverlayCircle {
  x: number;
  y: number;
  radius: number;
  color?: OverlayColor;
  width?: number;
  filled?: boolean;
  alpha?: number;
}

export interface OverlayLabel {
  x: number;
  /** Text baseline, not the top of the glyphs. */
  y: number;
  text: string;
  color?: OverlayColor;
  size?: number;
  alpha?: number;
}

/** One complete frame. Every `setScene` call replaces the previous frame. */
export interface OverlayScene {
  polylines?: OverlayPolyline[];
  circles?: OverlayCircle[];
  labels?: OverlayLabel[];
}

export interface OverlayDisplayMetrics {
  /** Physical pixels, including the region behind the system bars. */
  width: number;
  height: number;
  density: number;
}

// -- Screen capture ---------------------------------------------------------

/**
 * Thresholds for the native frame analyser. Every field is optional; the native
 * defaults are the measurements in `src/calibration/tableProfile.ts`.
 *
 * Only `scale` is fixed at capture start — it sizes the virtual display. The
 * rest are re-read on every frame, so they can be tuned live.
 */
export interface CaptureConfig {
  /** Capture resolution as a fraction of the display. Default 0.5. */
  scale?: number;
  /** Upper bound on analysed frames per second. Default 15. */
  fps?: number;

  /**
   * Learn the cloth colour off the table instead of matching a fixed one.
   *
   * The game sells table skins, and they are not variations on a theme: blue,
   * teal, green, brown and a near-black one all ship. A signature written for
   * any one of them finds no table at all on the rest.
   */
  clothAuto?: boolean;
  /**
   * Cloth colour to match when `clothAuto` is off, as `#RRGGBB`. Take it from
   * the middle of the playfield — the bands are built around it, so a sample
   * off a ball or a rail describes the wrong thing.
   */
  clothColor?: string;
  /**
   * How far a pixel's hue may sit off the cloth's: a distance in colour units
   * plus a fraction of the pixel's own colourfulness. The fraction is the part
   * that matters, because the shading is not a clean scaling — the light over
   * the table adds white and the cushion tints the shadow.
   */
  clothHueTolerance?: number;
  clothHueToleranceRatio?: number;
  /**
   * Frames without a plausible table before the learned cloth is thrown away
   * and looked for again. Long enough to sit through a pocket animation, short
   * enough that changing skin mid-session costs a couple of seconds.
   */
  clothRelearnFrames?: number;
  /**
   * Largest patch of cloth, in ball radii squared, thrown away when it turns
   * out to be cut off from the rest of the felt, and how much of its border has
   * to be brighter than cloth first.
   *
   * This is what stops the coloured spot on the cue ball from hollowing it out
   * on a brown or black table, without also closing the felt showing between
   * racked balls — which is enclosed the same way but ringed by dark rims.
   */
  clothIslandArea?: number;
  clothIslandBrightEdge?: number;
  /** Below this fraction of cloth pixels the table counts as not visible. */
  minClothFraction?: number;

  /** Ball radius as a fraction of playfield width. */
  ballRadiusRatio?: number;
  /**
   * How deep into the not-cloth region a distance-transform peak must sit,
   * as a fraction of the ball radius, before it counts as a ball centre.
   */
  ballPeakRatio?: number;
  /** Minimum centre-to-centre spacing of two accepted balls, in radii. */
  ballSeparationRadii?: number;
  /** Upper bound on a peak's depth, in radii; rejects merged blobs and rails. */
  maxDistanceRadii?: number;
  /**
   * Fraction of the disc around a candidate that must be not-cloth. This is what
   * separates a ball from the cue stick, the HUD and a cushion notch, all of
   * which peak in the distance transform but leave cloth showing around them.
   */
  ballMinFill?: number;
  /** Blobs within this many radii of a pocket are cushion notches. */
  pocketExclusionRadii?: number;

  /** Radius of the disc sampled to classify a ball's face, in ball radii. */
  classifyRadii?: number;
  /** White fraction of the face above which a ball can be the cue ball. */
  cueMinWhite?: number;
  /**
   * Saturated fraction of the face below which a ball can be the cue ball. This
   * is what actually picks it out — a stripe reads whiter across the middle.
   */
  cueMaxSaturation?: number;
  /** Dark fraction of the face above which a ball is the eight. */
  eightMinDark?: number;
  /** White fraction separating a stripe from a solid. */
  stripeMinWhite?: number;

  /** Read the game's own aim guideline out of the frame. */
  detectAim?: boolean;
  /**
   * Outer bounds on what counts as a pixel of the game's overlay: brightest
   * channel at or above `guideMinValue`, with the channel spread no more than
   * `guideMaxSaturation` of it.
   *
   * Both are only bounds, because neither number means anything on its own. The
   * guideline is white drawn *through* the felt, so what comes out depends on
   * what it crosses: 255 on the pale blue table, 184 on the teal one, and 185
   * on the green one, where the cloth beside it reads 205 and is the brighter
   * of the two. The working thresholds are measured from the learned cloth on
   * every frame and clamped by these.
   */
  guideMinValue?: number;
  guideMaxSaturation?: number;
  /** Angular resolution of the vote accumulator, in degrees. */
  aimBinDegrees?: number;
  /** How many vote peaks are tried, and how far apart they must be. */
  aimPeaks?: number;
  aimPeakSeparationDegrees?: number;
  /**
   * Shape the lit run has to have to count as a guideline: start within this
   * many ball radii of the cue ball, reach this many, and be lit over this
   * fraction of its length.
   */
  aimMaxStartRadii?: number;
  aimMinRunRadii?: number;
  aimMinFill?: number;
  /** Below this many lit pixels there is nothing to fit. */
  aimMinPixels?: number;
  /** Largest break tolerated inside one run, in ball radii and in pixels. */
  aimMaxGapRadii?: number;
  aimMinGapPixels?: number;

  /** Fit the ghost-ball circle the game draws at the contact. */
  detectContact?: boolean;
  /** Window searched around the end of the guideline, in ball radii. */
  contactSearchRadii?: number;
  /** Range of circle radii tried, in ball radii. */
  contactMinRadii?: number;
  contactMaxRadii?: number;
  /** Fraction of a full circle that must be lit for a peak to count as a ring. */
  contactMinScore?: number;

  /**
   * Place each ball centre by fitting a circle to its rim rather than taking the
   * centroid of the distance transform's flat top. Measured over the test frames
   * this cuts the object-ball aim error from 2.4 to 2.0 degrees, because the
   * departure line is only one ball diameter long and a pixel of centre error is
   * nearly two degrees of it.
   */
  refineBallCenters?: boolean;
  /** Rim crossings that must survive rejection before the fit is trusted. */
  ballEdgeMinPoints?: number;
  /** How far the fit may move a centre before it is disbelieved, in ball radii. */
  ballEdgeMaxShiftRadii?: number;

  /**
   * Read the shot power off the meter on the left edge of the screen. What it
   * is worth is mostly path length — every path is drawn for
   * `power^2 * fullPowerTravel` pixels, a twenty-five fold range — and, on
   * shots short enough that the cue ball is still sliding when it arrives, the
   * departure angle too.
   */
  detectPower?: boolean;
  /** Fraction of the frame width searched for the meter, from the left edge. */
  powerMaxXFraction?: number;
  /** Shortest slot accepted, as a fraction of frame height. */
  powerMinSlotHeightFraction?: number;
  /** Slot width bounds, as fractions of frame width. */
  powerMaxSlotWidthFraction?: number;
  powerMinSlotWidthFraction?: number;
  /** What counts as ferrule: this bright, and this close to colourless. */
  powerTipMinValue?: number;
  powerTipMaxSpread?: number;
}

export type DetectedBallKind = 'cue' | 'eight' | 'stripe' | 'solid';

export interface DetectedBall {
  /** Screen pixels, same space as the overlay. */
  x: number;
  y: number;
  radius: number;
  kind: DetectedBallKind;
  /** 0..1. How strongly the blob matched its class. */
  confidence: number;
}

export interface DetectedPlayfield {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One analysed frame, in screen pixels. */
export interface FrameAnalysis {
  frameIndex: number;
  /** Wall-clock cost of analysing this frame. */
  elapsedMs: number;
  /** Analysis resolution, which is the display scaled by `CaptureConfig.scale`. */
  frameWidth: number;
  frameHeight: number;
  /** Fraction of the frame that matched the cloth signature. */
  clothFraction: number;
  playfield: DetectedPlayfield | null;
  balls: DetectedBall[];
  /**
   * The game's aim guideline direction in radians, screen space with +y down,
   * or null when no guideline was on screen.
   */
  aimAngle: number | null;
  /**
   * How far that guideline runs before it stops, in screen pixels.
   *
   * The game solved the collision to know where to end its line, so this is a
   * free second opinion on where the first obstruction is — and one that does
   * not depend on our ball detection being pixel-perfect. The engine uses it to
   * choose between obstructions its own cast finds ambiguous.
   */
  aimReach: number | null;
  /**
   * Centre and radius of the ghost-ball circle drawn at the contact, or null.
   *
   * This is where the cue ball's centre will be at impact, measured instead of
   * derived. The object ball leaves along the line from here to its own centre,
   * a baseline of just one ball diameter, so every pixel of error here is worth
   * close to two degrees of object-ball direction — and deriving it means
   * extending the aim over the whole shot first, which inflates a fraction of a
   * degree of aim error into several pixels. Cushion rebounds have no such lever,
   * which is why they come out right while object-ball lines drift.
   */
  contactX: number | null;
  contactY: number | null;
  contactRadius: number | null;
  /**
   * The power meter's ferrule position and the slot it slides in, in screen
   * pixels, or null when the meter is not on screen — which is most of the
   * time, since the game hides it when it is not your shot.
   *
   * Raw rather than a 0..1 power on purpose. The top of the slot is known to
   * mean no power, because that is where the stick rests, but what the bottom
   * means is not, so the conversion lives in JS where it can watch the extremes
   * across a session and calibrate itself. See `src/vision/power.ts`.
   */
  powerTipY: number | null;
  powerSlotTop: number | null;
  powerSlotBottom: number | null;
  /**
   * The cloth colour currently being matched, as `#RRGGBB`, or null before one
   * has been learned. Worth showing: it is the first thing to check when a
   * table skin the detector has never seen goes wrong.
   */
  clothColor: string | null;
  /** Why a frame produced nothing useful, when it did. */
  note: string | null;
}

export interface CaptureStateChangeEvent {
  running: boolean;
  reason: string | null;
}
