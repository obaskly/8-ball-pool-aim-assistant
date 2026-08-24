import type { CaptureConfig } from '../../modules/overlay-native';

/**
 * Must match `CaptureConfig.guideMinValue` in TableAnalyzer.kt. The working
 * floor adapts upward from the cloth's own brightness; this is the lowest it
 * can ever sit, which is the pessimistic bound a safety test wants.
 */
const DEFAULT_GUIDE_MIN_VALUE = 120;
/** Must match `CaptureConfig.guideMaxSaturation` in TableAnalyzer.kt. */
const DEFAULT_GUIDE_MAX_SATURATION = 0.43;

/**
 * Screen capture records our own overlay along with the game.
 *
 * The aim fit gathers every light, washed-out pixel in the playfield and looks
 * for the one that runs out from the cue ball — which is an exact description of
 * our own primary line. If our colours pass that filter, the overlay reads its
 * own output back and the angle latches wherever it last pointed: a feedback
 * loop that looks, from the outside, like the detector simply not working.
 *
 * The way out is to stay outside the filter. It wants pixels that are bright
 * *and* close to grey, which the game's guideline always is whatever cue tint it
 * is drawn in, so any colour that keeps a real hue is invisible to it however
 * bright we make it. That is a cheap constraint on a palette and it costs
 * nothing visually, so every theme colour is expected to satisfy it.
 *
 * @returns true when this colour would be picked up by our own detector.
 */
export function readableByAimDetector(
  color: string,
  config: CaptureConfig = {}
): boolean {
  const value = maxChannel(color);
  if (value < (config.guideMinValue ?? DEFAULT_GUIDE_MIN_VALUE)) return false;

  const saturation = (value - minChannel(color)) / value;
  return saturation <= (config.guideMaxSaturation ?? DEFAULT_GUIDE_MAX_SATURATION);
}

/**
 * How much to trim off the start of our primary line so the detector cannot
 * follow it, for a theme whose primary colour would otherwise be read back.
 *
 * Zero for any palette that keeps its hue, which is every palette we ship. The
 * fallback is worth keeping anyway, because a user-supplied theme can put a
 * white line back on the screen: the fit only accepts a run that *begins* at the
 * cue ball, so starting ours further out than that disqualifies it without
 * costing anything the eye notices.
 */
export function primaryGapForCapture(
  primaryColor: string,
  ballRadius: number,
  config: CaptureConfig = {}
): number {
  if (!readableByAimDetector(primaryColor, config)) return 0;
  return ballRadius * ((config.aimMaxStartRadii ?? 2) + 1);
}

/**
 * Lowest and highest of R, G and B. Accepts `#RGB`, `#RRGGBB` and the overlay's
 * `#AARRGGBB`.
 *
 * Alpha is ignored, and that is *not* always pessimistic: a pale colour partway
 * through a blend into a complementary cloth passes near grey — the cream
 * cue-ball ring over blue felt lands at 0.18 saturation, well inside the mask —
 * so translucency can make a safe colour readable. The palette leans on
 * placement for those cases: everything translucent in the theme is drawn at a
 * detected ball, inside the regions the fit already excludes. Colours meant for
 * open cloth must keep their hue at full opacity, which is what this checks.
 */
export function minChannel(color: string): number {
  const rgb = toRgb(color);
  return rgb === null ? 255 : Math.min(rgb[0], rgb[1], rgb[2]);
}

export function maxChannel(color: string): number {
  const rgb = toRgb(color);
  return rgb === null ? 255 : Math.max(rgb[0], rgb[1], rgb[2]);
}

function toRgb(color: string): [number, number, number] | null {
  const hex = color.replace('#', '');

  let rgb: string;
  if (hex.length === 3) {
    rgb = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  } else if (hex.length === 6) {
    rgb = hex;
  } else if (hex.length === 8) {
    rgb = hex.slice(2);
  } else {
    return null; // Unparseable: assume the worst.
  }

  const value = Number.parseInt(rgb, 16);
  if (Number.isNaN(value)) return null;

  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
