/** Colours are `#AARRGGBB`. Widths and radii are in screen pixels. */
export interface OverlayTheme {
  /** Cue ball path before it touches anything. */
  primary: string;
  /** Cue ball path after the tangent-line separation. */
  tangent: string;
  /** Any ball set in motion by an impact. */
  object: string;
  /** Ghost-ball ring at the primary contact. */
  ghost: string;
  /** Marker at each cushion bounce. */
  cushion: string;
  /** Pocket capture circles, shown in calibration mode. */
  pocket: string;
  /** Playfield outline, shown in calibration mode. */
  table: string;
  /** Ball rings, shown in calibration mode. */
  ball: string;
  cueBall: string;
  /** Highlight drawn where a ball drops. */
  potted: string;
  text: string;

  primaryWidth: number;
  tangentWidth: number;
  objectWidth: number;
  outlineWidth: number;
  ghostWidth: number;
  /** Dash length for the tangent line. */
  dash: number;
  markerRadius: number;
  textSize: number;
  /** Alpha multiplier applied once per generation of struck ball. */
  depthFalloff: number;
}

/**
 * Nothing here is white, and that is a hard requirement rather than a style
 * choice.
 *
 * Screen capture records our overlay along with the game, and the aim fit hunts
 * for exactly one thing: bright, near-grey pixels running out from the cue ball.
 * That is what the game's own guideline looks like under every cue tint, and it
 * is also what a white overlay line looks like — so a white palette makes the
 * detector read our last frame back and latch, which on screen is
 * indistinguishable from it being broken.
 *
 * The escape is that the filter only takes *washed-out* colours: keeping more
 * than a third of the peak channel's worth of saturation puts a colour outside
 * it at any brightness. Every entry below clears that, `readableByAimDetector`
 * is the test, and the theme test holds the whole palette to it.
 */
export const DEFAULT_THEME: OverlayTheme = {
  primary: '#FF39FF88',
  tangent: '#CC6FE3FF',
  object: '#FFFFD54F',
  ghost: '#E6FF6FD0',
  cushion: '#FFFF8A65',
  pocket: '#5900E5FF',
  table: '#4D7CFFD0',
  ball: '#668CE8FF',
  // Cream rather than another pale blue: it reads as the cue ball next to the
  // cyan rings, and a pale blue light enough to stand out from them came out at
  // 0.341 saturation, which clears the 0.34 cut-off by nothing worth having.
  cueBall: '#99FFE08C',
  potted: '#FFB388FF',
  text: '#F2FFF07A',

  primaryWidth: 4,
  tangentWidth: 3,
  objectWidth: 4,
  outlineWidth: 2,
  ghostWidth: 2.5,
  dash: 12,
  markerRadius: 7,
  textSize: 30,
  depthFalloff: 0.72,
};

export function resolveTheme(overrides?: Partial<OverlayTheme>): OverlayTheme {
  return overrides ? { ...DEFAULT_THEME, ...overrides } : DEFAULT_THEME;
}
