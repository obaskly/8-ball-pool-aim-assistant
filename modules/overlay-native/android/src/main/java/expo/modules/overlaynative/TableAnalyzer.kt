package expo.modules.overlaynative

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.nio.ByteBuffer
import java.util.Arrays
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Everything the frame analyser can be tuned with, so the thresholds can be
 * dialled in on a real device from the control panel instead of recompiled.
 *
 * Every default here was measured off real captures of the game rather than
 * guessed: see docs/vision-calibration.md for the numbers behind each one.
 */
class CaptureConfig : Record {
  /**
   * Capture resolution as a fraction of the real display.
   *
   * Accuracy is set by how many pixels a ball is across. Measured on real
   * captures, the aim fit holds to about a quarter of a degree at a 16 px ball
   * radius and starts to drop lines at 8 px, and a quarter of a degree is
   * already a couple of ball widths of object error across a full table. On a
   * 2340 px display this lands the radius near 18.
   */
  @Field var scale: Double = 0.75

  /** Upper bound on analysed frames per second. */
  @Field var fps: Double = 15.0

  // -- Cloth signature ------------------------------------------------------
  /**
   * Learn the cloth colour off the table instead of matching a fixed one.
   *
   * The game sells table skins, and they are not variations on a theme: blue,
   * teal, green, brown and a near-black one all ship, and a signature written
   * for any single one of them finds no table at all on the rest. What every
   * skin does share is the *shape* of the colour, which is what [ClothModel]
   * describes — one hue, shaded from the rails to the centre light, and washed
   * out by that light rather than shifted by it.
   */
  @Field var clothAuto: Boolean = true

  /**
   * Cloth colour to use when [clothAuto] is off, as `#RRGGBB`. Take it from the
   * middle of the playfield: the bands are built around it, so a sample off a
   * ball or a rail describes the wrong thing.
   */
  @Field var clothColor: String? = null

  /**
   * How far a pixel's hue may sit off the cloth's, as a distance in colour
   * units plus a fraction of the pixel's own colourfulness.
   *
   * The fraction is the part that matters, because the shading is not a clean
   * scaling: the centre light adds white, which shortens the chroma vector
   * without turning it, while the cushion shadow tints what is left. Measured
   * across the skins, cloth stays inside about a quarter of a turn of its own
   * hue, and everything else on the table — the rails, the chrome, the balls —
   * is further out than that or far more saturated.
   */
  @Field var clothHueTolerance: Double = 10.0
  @Field var clothHueToleranceRatio: Double = 0.40

  /**
   * Frames the detector will go without a plausible table before it throws the
   * learned cloth away and looks again. Long enough to sit through a pocket
   * animation or a menu, short enough that changing table skin mid-session
   * costs a couple of seconds rather than a restart.
   */
  @Field var clothRelearnFrames: Int = 25

  /**
   * Largest patch of cloth, in ball radii squared, that will be thrown away
   * when it turns out to be cut off from the rest of the felt.
   *
   * Sized between the two things that are enclosed like this. The ring of
   * pixels where the cue ball's coloured spot fades into its white face runs to
   * about a dozen; the felt showing between three racked balls is several times
   * that, and has to be kept, because without it a rack is one region too large
   * to be a ball and every ball in it is lost.
   */
  @Field var clothIslandArea: Double = 0.35

  /**
   * Fraction of an island's border that has to be brighter than cloth before it
   * is thrown away. See [clothIslandArea]: this is what tells a patch inside a
   * ball from the felt between three of them.
   */
  @Field var clothIslandBrightEdge: Double = 0.25

  /** Below this fraction of cloth pixels the table is considered occluded. */
  @Field var minClothFraction: Double = 0.08

  // -- Balls ----------------------------------------------------------------
  /** Ball radius as a fraction of playfield width. */
  @Field var ballRadiusRatio: Double = 0.015459

  /**
   * A pixel is a ball centre candidate once it is this many radii from the
   * nearest cloth.
   *
   * Under 1.0 so a ball half-hidden behind a drawn line or clipped by a cushion
   * still peaks, but not far under: at half a radius the cue stick, the HUD and
   * every notch in a cushion clear the bar too, and each one becomes a phantom
   * obstruction sitting in the middle of a predicted path.
   */
  @Field var ballPeakRatio: Double = 0.78

  /**
   * Radius of the local-maximum test and of the suppression that follows it, in
   * ball radii. Two balls are never closer than 2.0 radii centre to centre, so
   * anything below that cannot suppress a real neighbour.
   */
  @Field var ballSeparationRadii: Double = 1.30

  /**
   * The distance transform is clamped here, and anything that reaches the clamp
   * is thrown away.
   *
   * Both halves matter. Without the clamp a ball wedged in a group peaks far
   * above its own radius and drags the whole group into one maximum. Without the
   * rejection, every large not-cloth region — the cue stick, a HUD panel, the
   * rail behind a pocket — tops out at the clamp as one enormous plateau and is
   * indistinguishable from a ball that happens to be deep.
   */
  @Field var maxDistanceRadii: Double = 1.5

  /**
   * Fraction of the disc around a candidate that has to be not-cloth before it
   * counts as a ball, sampled at 0.85 radii.
   *
   * This is the test that separates a ball from everything else shaped a bit
   * like one. A ball fills its own disc completely; a ridge along the cue stick
   * or a sliver of HUD is deep in one direction only, and cloth shows through
   * the rest.
   */
  @Field var ballMinFill: Double = 0.72

  /** Candidates this close to a pocket mouth are cushion notches, not balls. */
  @Field var pocketExclusionRadii: Double = 1.9

  // -- Classification -------------------------------------------------------
  /**
   * Fraction of a ball's face sampled when reading its colours.
   *
   * Nearly the whole disc, because a striped ball is a white band with a
   * coloured ring around it: sampling only the middle makes a stripe look
   * exactly like the cue ball, and picking the wrong cue ball puts every line
   * on the screen in the wrong place.
   */
  @Field var classifyRadii: Double = 0.90

  /** The cue ball is the whitest face on the table, and clears this bar. */
  @Field var cueMinWhite: Double = 0.45

  /**
   * Ceiling on the fraction of a face that carries a saturated colour. Over the
   * full disc the cue ball measures 0.03 to 0.10 and every other ball at least
   * 0.20, so this is the test that actually finds the cue ball; whiteness only
   * separates it from the equally unsaturated eight.
   */
  @Field var cueMaxSaturation: Double = 0.15

  /** The eight is dark nearly everywhere. */
  @Field var eightMinDark: Double = 0.45

  /** A stripe is white over roughly half its face; a solid only at its number. */
  @Field var stripeMinWhite: Double = 0.22

  // -- Aim line -------------------------------------------------------------
  /** Read the game's own aim guideline out of the frame. */
  @Field var detectAim: Boolean = true

  /**
   * Absolute floor on a guideline pixel's brightest channel, and absolute
   * ceiling on how far its darkest channel may fall below it, as a fraction.
   *
   * Both are outer bounds on a test that is otherwise measured against the
   * cloth, because neither number means anything on its own. The guideline is
   * white drawn *through* the felt, so what comes out depends on what it is
   * drawn over: 255 on the pale blue table, 184 on the teal one, and only 185
   * on the green one — where the cloth beside it reads 205 and is the brighter
   * of the two. A fixed floor high enough for the blue table finds no line at
   * all on the other skins, which is exactly what going quiet on every table
   * but one looks like from the outside.
   *
   * What holds everywhere is that the line is *washed out where the cloth is
   * not*: measured across the skins the felt keeps at least a quarter of its
   * peak channel as colour and the line keeps under a tenth. So the working
   * ceiling is set from the cloth's own saturation and this is only its upper
   * limit. The guideline is not white either — the game tints it with whatever
   * cue is equipped, and a mint-green line measures 55 counts of spread — so
   * the ceiling cannot be tightened to near-grey.
   */
  @Field var guideMinValue: Int = 120
  @Field var guideMaxSaturation: Double = 0.34

  /** Angular resolution of the vote accumulator, in degrees. */
  @Field var aimBinDegrees: Double = 0.25

  /** How many vote peaks are tried, and how far apart they have to be. */
  @Field var aimPeaks: Int = 6
  @Field var aimPeakSeparationDegrees: Double = 6.0

  /**
   * The lit run has to start within this many radii of the cue ball, reach this
   * many, and have this fraction of its length lit.
   *
   * Starting at the cue ball is the discriminating test. Distance-weighted
   * votes make a far-off scatter of HUD pixels loud enough to outscore a real
   * line, and those scatters are convincing on every other measure - but they
   * do not reach back to the ball the guideline is drawn from.
   */
  @Field var aimMaxStartRadii: Double = 2.0
  @Field var aimMinRunRadii: Double = 2.2
  @Field var aimMinFill: Double = 0.70

  /** Below this many lit pixels there is nothing to fit. */
  @Field var aimMinPixels: Int = 45

  /** Largest break tolerated inside one run, in ball radii and in pixels. */
  @Field var aimMaxGapRadii: Double = 0.44
  @Field var aimMinGapPixels: Double = 4.0

  /** Look for the ghost-ball circle the game draws at the contact. */
  @Field var detectContact: Boolean = true
  /**
   * How far around the end of the guideline to search, in ball radii. The run
   * measurement tends to overshoot the contact, because the game's tangent line
   * carries on from the same point and the run walks straight onto it, so the
   * circle is generally a little *behind* where the guideline appears to stop.
   */
  @Field var contactSearchRadii: Double = 3.2
  /** Range of circle radii tried, in ball radii. The drawn ring runs a little
   *  inside the ball itself. */
  @Field var contactMinRadii: Double = 0.70
  @Field var contactMaxRadii: Double = 1.35
  /**
   * Fraction of a full circle that has to be lit before a peak counts as a ring.
   * The drawn circle is broken where the guideline and the tangent cross it, so
   * this cannot ask for all of it.
   */
  @Field var contactMinScore: Double = 0.55

  /**
   * Refine each ball centre by fitting a circle to its rim instead of taking the
   * centroid of the distance transform's flat top.
   *
   * The flat top is a handful of pixels on an integer grid, and anything else
   * not-cloth touching the ball drags it off centre. The rim is a whole
   * circumference, and the cloth test has a continuous margin behind it, so each
   * crossing can be placed between pixels. It matters more than it sounds: the
   * object ball departs along the line from the contact to its centre, a baseline
   * of only one ball diameter, so a pixel of centre error is nearly two degrees
   * of aim. Measured over the test frames this halves that error.
   */
  @Field var refineBallCenters: Boolean = true
  /**
   * How many rim crossings have to survive rejection for the fit to be used.
   * A ball wedged in a group or against a rail loses whole sectors, and below
   * this the circle is being fitted to an arc too short to place a centre on, so
   * the flat-top centroid is kept instead.
   */
  @Field var ballEdgeMinPoints: Int = 48
  /** How far the fit may move a centre before it is disbelieved, in ball radii. */
  @Field var ballEdgeMaxShiftRadii: Double = 0.5

  // -- Power meter ------------------------------------------------------------

  /**
   * Read the shot power off the meter on the left edge of the screen.
   *
   * The meter is a cue stick in a vertical slot: at rest the white ferrule sits
   * at the top, and dragging for power slides the whole stick down. So the
   * reading is just the ferrule's y within the slot. What it is worth is mostly
   * path length — every path is drawn for `power^2 * fullPowerTravel` pixels, a
   * twenty-five fold range — and, on shots short enough that the cue ball is
   * still sliding when it arrives, the departure angle as well.
   */
  @Field var detectPower: Boolean = true
  /**
   * Fraction of the frame width searched for the meter, from the left edge.
   * The table's red cushion answers the same colour test and is the reason this
   * is bounded rather than a whole-frame search.
   */
  @Field var powerMaxXFraction: Double = 0.16
  /** Shortest slot accepted, as a fraction of frame height. */
  @Field var powerMinSlotHeightFraction: Double = 0.35
  /** Widest slot accepted, as a fraction of frame width. */
  @Field var powerMaxSlotWidthFraction: Double = 0.05
  /**
   * Narrowest slot accepted, as a fraction of frame width. This is what tells
   * the meter from the sliver of cushion that shows past the left rail, which
   * is warm, tall and about a third the width.
   */
  @Field var powerMinSlotWidthFraction: Double = 0.008
  /**
   * What counts as ferrule: brightest channel at or above `powerTipMinValue`
   * with the channel spread no more than `powerTipMaxSpread`. The slot holds
   * nothing else that is both bright and colourless — the shaft is tan and the
   * track behind it is olive through dark red.
   */
  @Field var powerTipMinValue: Int = 150
  @Field var powerTipMaxSpread: Int = 60
}

class DetectedBall(
  val x: Float,
  val y: Float,
  val radius: Float,
  val kind: String,
  val confidence: Float
)

class AnalysisResult(
  val frameIndex: Long,
  val elapsedMs: Long,
  val frameWidth: Int,
  val frameHeight: Int,
  val clothFraction: Float,
  /** left, top, right, bottom in *screen* pixels, or null when not found. */
  val playfield: FloatArray?,
  val balls: List<DetectedBall>,
  /** Radians in screen space (+y down), or null when no guideline was found. */
  val aimAngle: Float?,
  /**
   * How far the guideline runs before it stops, in *screen* pixels, or null
   * alongside a null angle.
   *
   * The game has already solved the collision to draw that line, so its length
   * is an independent measurement of where the first obstruction is — and one
   * that costs nothing. Handing it downstream lets the prediction check its own
   * geometry against what the game itself decided.
   */
  val aimReach: Float?,
  /**
   * Centre of the ghost-ball circle the game draws at the contact, in *screen*
   * pixels, or null when there was none to find.
   *
   * This is where the cue ball's centre will be when it strikes, measured rather
   * than worked out, and it is the one number the object ball's direction is most
   * sensitive to — see `findContactRing`.
   */
  val contactX: Float? = null,
  val contactY: Float? = null,
  val contactRadius: Float? = null,
  /**
   * The power meter's ferrule position and the slot it travels in, all in
   * *screen* pixels, or null when the meter was not on screen — which is most
   * of the time, since the game hides it when it is not your shot.
   *
   * Deliberately raw rather than a 0..1 power: what the top of the slot means
   * is known (the stick is at rest there, so no power) but what the bottom
   * means is not, and the honest place to settle that is JS, which can watch
   * the extremes across a session and calibrate itself.
   */
  val powerTipY: Float? = null,
  val powerSlotTop: Float? = null,
  val powerSlotBottom: Float? = null,
  /**
   * The cloth colour currently being matched, as `#RRGGBB`, or null before one
   * has been learned. Only useful for showing the user what the detector thinks
   * it is looking at, which is the first thing to check when a table skin it
   * has never seen goes wrong.
   */
  val clothColor: String? = null,
  val note: String? = null
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "frameIndex" to frameIndex.toDouble(),
    "elapsedMs" to elapsedMs.toDouble(),
    "frameWidth" to frameWidth,
    "frameHeight" to frameHeight,
    "clothFraction" to clothFraction,
    "playfield" to playfield?.let {
      mapOf("left" to it[0], "top" to it[1], "right" to it[2], "bottom" to it[3])
    },
    "balls" to balls.map {
      mapOf(
        "x" to it.x,
        "y" to it.y,
        "radius" to it.radius,
        "kind" to it.kind,
        "confidence" to it.confidence
      )
    },
    "aimAngle" to aimAngle,
    "aimReach" to aimReach,
    "contactX" to contactX,
    "contactY" to contactY,
    "contactRadius" to contactRadius,
    "powerTipY" to powerTipY,
    "powerSlotTop" to powerSlotTop,
    "powerSlotBottom" to powerSlotBottom,
    "clothColor" to clothColor,
    "note" to note
  )
}

/**
 * What the cloth on the table currently on screen looks like.
 *
 * The game ships table skins in blue, teal, green, brown and a near-black, so
 * there is no one colour to test for. What holds across all of them is the
 * *shape* of the colour, and this is that shape written down:
 *
 *  * **One hue.** Split a pixel into a grey part and a chroma part. Shading the
 *    cloth scales the chroma, and the light over the table adds grey, and
 *    neither turns it — so every shade of one cloth lies along a single ray out
 *    of the grey axis. Distance from that ray is what tells cloth from a rail,
 *    from a ball, and from the chrome around the table. On the near-black skin
 *    the ray has no direction at all, which comes out right on its own: the
 *    test collapses to "barely any chroma", which is what that cloth is.
 *  * **A run along it.** Cloth occupies a band of that ray, not the whole of
 *    it. The floor is what separates the blue skin from the app's own navy
 *    chrome, which shares its hue exactly and is only less saturated. The
 *    ceiling is what keeps a blue ball on a blue table from reading as cloth.
 *  * **A brightness window.** From the vignette at the rails to the light in
 *    the middle, with the shadow under the cushion nose below it and the balls
 *    above.
 *
 * Every bound is measured off the table rather than fixed, because the spread
 * differs enormously between skins — the green table's chroma runs three times
 * the teal one's. See [TableAnalyzer.learnCloth] for how they are picked.
 *
 * Two sets of the floors are kept rather than one. Finding the playfield wants
 * the tighter reading, because the walls of the table are the one place a
 * leaking mask is expensive: cross the cushion nose and the rectangle grows by
 * the width of the rail. Finding balls wants the looser one, because there
 * every pixel of real cloth that fails the test becomes not-cloth, and enough
 * of them together swallow a ball. The two answers are packed into one lookup
 * table as two bits.
 */
class ClothModel(
  val r0: Int,
  val g0: Int,
  val b0: Int,
  /** Unit vector along the cloth's chroma, or zero when the cloth is grey. */
  val ur: Float,
  val ug: Float,
  val ub: Float,
  /** Length of the model colour's own chroma. Zero for a grey cloth. */
  val chroma: Float,
  val luma: Float,
  val neutral: Boolean,
  val hueAbs: Float,
  val hueRatio: Float,
  val projLoBall: Float,
  val projLoRect: Float,
  val projHi: Float,
  val yLoBall: Float,
  val yLoRect: Float,
  val yHi: Float,
  /**
   * What the game's own guideline looks like *against this cloth*: at least
   * this bright in its strongest channel, and no more colourful than this
   * fraction of it. Both measured from the felt, which is the only thing in
   * frame that says how a white line drawn over it will come out.
   */
  val guideMinValue: Float,
  val guideMaxSaturation: Float
) {
  /**
   * Quantised colour to `0`, `1` (cloth for ball detection) or `3` (cloth for
   * both). Five bits a channel: the bands are tens of counts wide, so an
   * eight-count bucket moves an edge by a fraction of a pixel, and the rim fit
   * that does care reads [TableAnalyzer.clothMargin] directly instead.
   */
  val lut: ByteArray = ByteArray(32 * 32 * 32).also { table ->
    var i = 0
    for (r in 0 until 32) {
      for (g in 0 until 32) {
        for (b in 0 until 32) {
          table[i++] = level((r shl 3) or 4, (g shl 3) or 4, (b shl 3) or 4).toByte()
        }
      }
    }
  }

  fun level(r: Int, g: Int, b: Int): Int {
    val y = (2 * r + 5 * g + b) / 8f
    if (y < yLoBall || y > yHi) return 0
    val m = (r + g + b) / 3f
    val qr = r - m
    val qg = g - m
    val qb = b - m
    val mag = sqrt(qr * qr + qg * qg + qb * qb)
    val proj = if (neutral) 0f else qr * ur + qg * ug + qb * ub
    val perpSq = mag * mag - proj * proj
    val perp = if (perpSq > 0f) sqrt(perpSq) else 0f
    if (perp > hueAbs + hueRatio * mag) return 0
    if (!neutral && (proj < projLoBall || proj > projHi)) return 0
    val tight = y >= yLoRect && (neutral || proj >= projLoRect)
    return if (tight) 3 else 1
  }

  /**
   * Signed distance to the edge of the cloth test in colour units: positive on
   * cloth, negative off it, and zero where the boolean test flips.
   *
   * Interpolating this between neighbouring pixels is what lets a ball's rim be
   * placed between them rather than on one or the other; see
   * [TableAnalyzer.refineBallCenter], which is worth about two degrees of
   * object-ball aim.
   */
  fun margin(r: Int, g: Int, b: Int): Float {
    val y = (2 * r + 5 * g + b) / 8f
    val m = (r + g + b) / 3f
    val qr = r - m
    val qg = g - m
    val qb = b - m
    val mag = sqrt(qr * qr + qg * qg + qb * qb)
    val proj = if (neutral) 0f else qr * ur + qg * ug + qb * ub
    val perpSq = mag * mag - proj * proj
    val perp = if (perpSq > 0f) sqrt(perpSq) else 0f

    var out = (hueAbs + hueRatio * mag) - perp
    val lowY = y - yLoBall
    if (lowY < out) out = lowY
    val highY = yHi - y
    if (highY < out) out = highY
    if (!neutral) {
      val lowP = proj - projLoBall
      if (lowP < out) out = lowP
      val highP = projHi - proj
      if (highP < out) out = highP
    }
    return out
  }

  fun hex(): String = String.format("#%02X%02X%02X", r0, g0, b0)
}

/**
 * Finds the table, the balls and the aim line in a captured frame.
 *
 *  1. Segment the cloth by colour signature.
 *  2. Take each cushion face as the *median* first/last cloth pixel across
 *     scanlines. The median is what makes this robust: pocket mouths and balls
 *     resting against a cushion only disturb a minority of the lines.
 *  3. Ball centres are peaks of the distance transform of not-cloth. This is
 *     the step that makes the reading survive being drawn on top of: the
 *     capture includes our own overlay, and a trajectory line is only a few
 *     pixels wide, so it never gets far enough from cloth to peak. Connected
 *     components cannot do that - a line touching a ball merges with it and
 *     takes the whole blob out of range of any area filter.
 *  4. The aim direction is fitted to the game's own guideline, as a line through
 *     the cue ball centre: every lit pixel votes once for the angle it subtends
 *     there, so the far end of the line - the part that actually pins the angle
 *     down - is used at full precision.
 *
 * Step 4 is where the accuracy lives. An aim error survives the shot amplified:
 * over a travel D it lands the object ball off by asin(D * tan(e) / 2R), so at a
 * 16 px radius and 400 px of travel one degree of aim becomes twelve degrees of
 * object direction. Sampling rays around the cue ball cannot do better than the
 * step size and drifts off a two-pixel line at range; fitting every pixel at
 * once does an order of magnitude better than the sweep it replaced.
 *
 * Every buffer is allocated once and reused, so a steady-state frame allocates
 * only the result objects.
 */
class TableAnalyzer {

  private var pixels = IntArray(0)
  private var cloth = BooleanArray(0)
  private var guide = BooleanArray(0)
  private var distance = IntArray(0)
  private var ballMask = BooleanArray(0)
  private var peakMask = BooleanArray(0)
  private var stack = IntArray(0)
  private var ringX = FloatArray(MAX_RING_PIXELS)
  private var ringY = FloatArray(MAX_RING_PIXELS)
  private var ringAcc = FloatArray(0)
  private var edgeX = FloatArray(EDGE_RAYS)
  private var edgeY = FloatArray(EDGE_RAYS)
  private var edgeR = FloatArray(EDGE_RAYS)
  private var edgeSorted = FloatArray(EDGE_RAYS)
  private var edgeKeep = BooleanArray(EDGE_RAYS)
  private var scratch = ByteArray(0)
  /** Cloth margin over a window around one ball, for the rim fit. */
  private var marginBox = FloatArray(0)
  private var marginX0 = 0
  private var marginY0 = 0
  private var marginX1 = -1
  private var marginY1 = -1
  private var marginW = 0
  private var rowFirst = IntArray(0)
  private var rowLast = IntArray(0)
  private var colFirst = IntArray(0)
  private var colLast = IntArray(0)
  private var litU = FloatArray(0)
  private var litV = FloatArray(0)
  private var litD = FloatArray(0)
  private var votes = FloatArray(0)
  private var smoothed = FloatArray(0)
  private var runBins = IntArray(0)
  private var capacity = 0

  /**
   * Half-resolution copy of the tight cloth test, and the connected region of
   * it that the playfield is measured from.
   *
   * Half resolution because the rectangle is wanted to a pixel or two out of a
   * thousand and the fill costs a quarter as much there. The fill itself is
   * what makes the measurement survive a skin whose cloth colour matches the
   * app's own chrome: the two are never connected, because the rail runs
   * between them.
   */
  private var halfTight = BooleanArray(0)
  private var halfFill = BooleanArray(0)
  private var halfStack = IntArray(0)
  private var halfCapacity = 0

  /** Samples taken off the table while learning, and their derived measures. */
  private var sampleR = IntArray(0)
  private var sampleG = IntArray(0)
  private var sampleB = IntArray(0)
  private var sortBuf = FloatArray(0)
  private var projBuf = FloatArray(0)
  private var perpBuf = FloatArray(0)
  private var lumaBuf = FloatArray(0)
  private var satBuf = FloatArray(0)
  private var peakBuf = FloatArray(0)

  /** The cloth currently being matched, and how long it has been failing. */
  private var model: ClothModel? = null
  private var misses = 0
  /**
   * Frames to wait before looking for the cloth again after a failed attempt.
   *
   * Learning costs several passes over the frame and is meant to be rare. With
   * no table on screen at all — a menu, a loading screen, the app itself — it
   * fails every time, and without this it would fail fifteen times a second.
   */
  private var learnCooldown = 0
  /** Centre of the last plausible playfield, in half-resolution pixels. */
  private var seedX = -1
  private var seedY = -1

  /** Throws the learned cloth away, so the next frame looks at the table again. */
  fun forgetCloth() {
    model = null
    misses = 0
    learnCooldown = 0
    seedX = -1
    seedY = -1
  }

  private fun ensure(width: Int, height: Int, byteCount: Int) {
    val n = width * height
    if (n > capacity) {
      pixels = IntArray(n)
      cloth = BooleanArray(n)
      guide = BooleanArray(n)
      distance = IntArray(n)
      ballMask = BooleanArray(n)
      peakMask = BooleanArray(n)
      stack = IntArray(n / 4)
      capacity = n
    }
    val hn = ((width + 1) / 2) * ((height + 1) / 2)
    if (hn > halfCapacity) {
      halfTight = BooleanArray(hn)
      halfFill = BooleanArray(hn)
      halfStack = IntArray(hn / 2 + 16)
      halfCapacity = hn
    }
    if (sampleR.size < MAX_SAMPLES) {
      sampleR = IntArray(MAX_SAMPLES)
      sampleG = IntArray(MAX_SAMPLES)
      sampleB = IntArray(MAX_SAMPLES)
      sortBuf = FloatArray(MAX_SAMPLES)
      projBuf = FloatArray(MAX_SAMPLES)
      perpBuf = FloatArray(MAX_SAMPLES)
      lumaBuf = FloatArray(MAX_SAMPLES)
      satBuf = FloatArray(MAX_SAMPLES)
      peakBuf = FloatArray(MAX_SAMPLES)
    }
    if (rowFirst.size < height) {
      rowFirst = IntArray(height)
      rowLast = IntArray(height)
    }
    if (colFirst.size < width) {
      colFirst = IntArray(width)
      colLast = IntArray(width)
    }
    if (scratch.size < byteCount) scratch = ByteArray(byteCount)
  }

  /**
   * @param buffer RGBA_8888 plane straight from the ImageReader.
   * @param toScreen multiplier from analysis pixels back to display pixels.
   */
  fun analyze(
    buffer: ByteBuffer,
    width: Int,
    height: Int,
    rowStride: Int,
    pixelStride: Int,
    toScreen: Float,
    frameIndex: Long,
    config: CaptureConfig
  ): AnalysisResult {
    val started = System.nanoTime()
    buffer.position(0)
    val byteCount = buffer.remaining()
    ensure(width, height, byteCount)

    // One bulk copy. Per-byte absolute gets on a direct buffer are an order of
    // magnitude slower, and this runs on every frame.
    buffer.get(scratch, 0, byteCount)

    val total = width * height

    val manual = if (config.clothAuto) null else parseCloth(config.clothColor)
    if (manual != null &&
      model?.let { it.r0 == manual[0] && it.g0 == manual[1] && it.b0 == manual[2] } != true
    ) {
      model = fixedCloth(manual[0], manual[1], manual[2], config)
    }

    // Only relearn once the table has been gone for a while: pocket animations,
    // menus and the moment of the shot all produce frames with no readable
    // table, and throwing the colour away on each one would relearn several
    // times a second off whatever happened to be on screen.
    val mustLearn = manual == null &&
      (model == null || misses >= config.clothRelearnFrames.coerceAtLeast(1))

    // Unpacking and masking share a pass in the ordinary case, which is worth
    // about two milliseconds a frame. Only when the cloth has to be learned do
    // they separate, because learning reads the pixels and the mask is measured
    // against what it finds.
    var clothCount = if (mustLearn) {
      unpackFrame(width, height, rowStride, pixelStride)
      -1
    } else {
      applyCloth(model!!, width, height, true, rowStride, pixelStride)
    }

    if (mustLearn) {
      if (learnCooldown > 0) {
        learnCooldown--
      } else {
        val learned = learnCloth(width, height, config)
        if (learned != null) {
          model = learned
          misses = 0
        } else {
          model = null
          learnCooldown = LEARN_COOLDOWN_FRAMES
        }
      }
    }

    val current = model
    if (current == null) {
      return AnalysisResult(
        frameIndex, elapsedMs(started), width, height, 0f,
        null, emptyList(), null, null, note = "no table colour"
      )
    }
    if (clothCount < 0) clothCount = applyCloth(current, width, height, false, 0, 0)
    val clothFraction = clothCount.toFloat() / total
    if (clothFraction < config.minClothFraction) {
      misses++
      return AnalysisResult(
        frameIndex, elapsedMs(started), width, height, clothFraction,
        null, emptyList(), null, null,
        clothColor = current.hex(), note = "table not visible"
      )
    }

    val rect = findPlayfield(width, height)
    if (rect == null) {
      misses++
      return AnalysisResult(
        frameIndex, elapsedMs(started), width, height, clothFraction,
        null, emptyList(), null, null,
        clothColor = current.hex(), note = "playfield not found"
      )
    }

    // A rectangle nothing like a table is the signal that the learned colour is
    // matching something else — a menu background, a replay camera, or a skin
    // that changed underneath us. Counted rather than acted on immediately, so
    // one covered frame costs nothing.
    val aspect = (rect.right - rect.left).toFloat() / max(1, rect.bottom - rect.top)
    if (aspect < MIN_TABLE_ASPECT || aspect > MAX_TABLE_ASPECT) misses++ else misses = 0
    seedX = ((rect.left + rect.right) / 4).coerceIn(0, (width + 1) / 2 - 1)
    seedY = ((rect.top + rect.bottom) / 4).coerceIn(0, (height + 1) / 2 - 1)

    val ballRadius = ((rect.right - rect.left) * config.ballRadiusRatio).toFloat()
    if (ballRadius < 2.5f) {
      return AnalysisResult(
        frameIndex, elapsedMs(started), width, height, clothFraction,
        rect.toScreen(toScreen), emptyList(), null, null,
        clothColor = current.hex(), note = "capture scale too low"
      )
    }

    dropClothIslands(current, width, rect, ballRadius, config)

    val balls = findBalls(width, height, rect, ballRadius, config)
    val cue = balls.firstOrNull { it.kind == "cue" }

    val aim = if (config.detectAim && cue != null) {
      findAimAngle(width, rect, cue, ballRadius, config)
    } else {
      null
    }

    // Search around the far end of the guideline. `guide` still holds the mask
    // `findAimAngle` built, so this costs one pass over a small window.
    val contact = if (config.detectContact && aim != null && cue != null) {
      findContactRing(
        width,
        height,
        cue.x + aim.reach * cos(aim.angle),
        cue.y + aim.reach * sin(aim.angle),
        ballRadius,
        config
      )
    } else {
      null
    }

    // The meter sits outside the playfield, so this runs on the whole frame.
    // Contained deliberately: the meter only refines the shot, while the lines
    // are the whole point of the overlay, so a fault looking for it must cost
    // the power reading and nothing else. It has already cost more than that
    // once, when this read the frame with the wrong stride and threw on every
    // frame, which stopped any result being published at all.
    val meter = FloatArray(3)
    val hasMeter = config.detectPower && try {
      findPowerMeter(width, height, config, meter)
    } catch (e: Exception) {
      false
    }

    return AnalysisResult(
      frameIndex = frameIndex,
      elapsedMs = elapsedMs(started),
      frameWidth = width,
      frameHeight = height,
      clothFraction = clothFraction,
      playfield = rect.toScreen(toScreen),
      powerTipY = if (hasMeter && !meter[2].isNaN()) meter[2] * toScreen else null,
      powerSlotTop = if (hasMeter) meter[0] * toScreen else null,
      powerSlotBottom = if (hasMeter) meter[1] * toScreen else null,
      balls = balls.map {
        DetectedBall(
          it.x * toScreen,
          it.y * toScreen,
          it.radius * toScreen,
          it.kind,
          it.confidence
        )
      },
      aimAngle = aim?.angle,
      aimReach = aim?.let { it.reach * toScreen },
      contactX = contact?.let { it.x * toScreen },
      contactY = contact?.let { it.y * toScreen },
      contactRadius = contact?.let { it.radius * toScreen },
      clothColor = current.hex(),
      note = if (cue == null) "no cue ball" else null
    )
  }

  // -- Cloth -----------------------------------------------------------------

  /**
   * Runs the cloth and guideline tests over the frame, filling [cloth], its
   * half-resolution tight copy, and [guide]. Returns the number of cloth pixels.
   *
   * With [unpack] set it also reads the frame out of [scratch] into [pixels] on
   * the way, which is the ordinary case: both jobs walk the frame once instead
   * of twice.
   */
  private fun applyCloth(
    m: ClothModel,
    width: Int,
    height: Int,
    unpack: Boolean,
    rowStride: Int,
    pixelStride: Int
  ): Int {
    val lut = m.lut
    val hw = (width + 1) / 2
    val guideValue = m.guideMinValue
    val guideSat = m.guideMaxSaturation
    val rowPadding = rowStride - pixelStride * width
    var src = 0
    var count = 0
    for (y in 0 until height) {
      val base = y * width
      val half = (y / 2) * hw
      val even = (y and 1) == 0
      for (x in 0 until width) {
        val i = base + x
        val p: Int
        if (unpack) {
          p = ((scratch[src].toInt() and 0xFF) shl 16) or
            ((scratch[src + 1].toInt() and 0xFF) shl 8) or
            (scratch[src + 2].toInt() and 0xFF)
          pixels[i] = p
          src += pixelStride
        } else {
          p = pixels[i]
        }
        val level = lut[
          (((p shr 19) and 0x1F) shl 10) or
            (((p shr 11) and 0x1F) shl 5) or
            ((p shr 3) and 0x1F)
        ].toInt()
        val isCloth = level != 0
        cloth[i] = isCloth
        if (isCloth) count++
        if (even && (x and 1) == 0) halfTight[half + (x / 2)] = level > 1

        val r = (p shr 16) and 0xFF
        val g = (p shr 8) and 0xFF
        val b = p and 0xFF
        val hi = if (r > g) (if (r > b) r else b) else (if (g > b) g else b)
        val lo = if (r < g) (if (r < b) r else b) else (if (g < b) g else b)
        guide[i] = hi >= guideValue && (hi - lo) <= guideSat * hi
      }
      if (unpack) src += rowPadding
    }
    return count
  }

  /** Unpacks the frame into [pixels] without masking it. Used only when the
   *  cloth still has to be learned, which needs these pixels first. */
  private fun unpackFrame(width: Int, height: Int, rowStride: Int, pixelStride: Int) {
    val rowPadding = rowStride - pixelStride * width
    var src = 0
    var dst = 0
    for (y in 0 until height) {
      for (x in 0 until width) {
        pixels[dst] = ((scratch[src].toInt() and 0xFF) shl 16) or
          ((scratch[src + 1].toInt() and 0xFF) shl 8) or
          (scratch[src + 2].toInt() and 0xFF)
        src += pixelStride
        dst++
      }
      src += rowPadding
    }
  }

  /**
   * Removes cloth-coloured specks that sit wholly inside something brighter
   * than cloth, so that a coloured spot painted on a ball does not hollow it
   * out.
   *
   * Four sweeps, one per direction, each recording whether the *nearest*
   * not-cloth pixel that way is within reach and is bright. Insisting it be the
   * nearest is the whole trick: inside a ball the nearest thing in every
   * direction is the lit face, while the real cloth showing between two racked
   * balls has their dark rims nearest instead, and stays cloth. Without that
   * distinction a filter wide enough to close a cue-ball spot also closes the
   * gaps in a rack, and the rack becomes one blob too large to be a ball.
   */
  /**
   * Drops small patches of cloth that are wholly enclosed by something else.
   *
   * The cue ball carries a coloured spot in several skins, and on a brown or a
   * black table the ring of pixels where that spot fades into the white face
   * answers the cloth test. Twelve such pixels in the middle of a ball take the
   * distance transform's peak there from a full radius down to a fifth of one,
   * and lose the single ball the whole prediction hangs off — so the ball is
   * simply not there, and the overlay draws nothing at all.
   *
   * Enclosure is the first test: cloth is one connected sheet, and anything
   * cloth-coloured that cannot be reached from the middle of the table without
   * crossing something else is sitting on top of it rather than being it.
   *
   * The second test is what it is enclosed *by*, and it is the one that
   * matters, because the felt showing between three racked balls is cut off in
   * exactly the same way and about the same size. That felt is ringed by the
   * balls' dark rims; a patch inside a ball is ringed by its lit face. So an
   * island only goes if a fair part of what surrounds it is brighter than cloth
   * can be. Get this wrong the other way and a rack becomes one region too
   * large to be a ball, and every ball in it is lost.
   */
  private fun dropClothIslands(
    m: ClothModel,
    width: Int,
    rect: IntRect,
    ballRadius: Float,
    config: CaptureConfig
  ) {
    edgeModel = m
    val cap = (ballRadius * ballRadius * config.clothIslandArea).roundToInt()
    if (cap < 1) return
    val x0 = rect.left
    val x1 = rect.right
    val y0 = rect.top
    val y1 = rect.bottom
    if (x1 - x0 < 4 || y1 - y0 < 4) return

    for (y in y0..y1) Arrays.fill(peakMask, y * width + x0, y * width + x1 + 1, false)

    // The sheet has already been found once, at half resolution, by the pass
    // that measured the playfield — so it is not filled again here. Any cloth
    // pixel whose half-resolution neighbourhood belongs to that sheet is part of
    // it and needs no further thought, which leaves only the pixels that might
    // be cut off to be filled and sized, and those are a tiny share of the
    // table. Doing the whole thing again at full resolution cost three and a
    // half milliseconds a frame for the same answer.
    val hw = (width + 1) / 2
    for (y in y0..y1) {
      val base = y * width
      val half = (y / 2) * hw
      for (x in x0..x1) {
        val i = base + x
        if (!cloth[i] || peakMask[i]) continue
        if (halfFill[half + (x / 2)]) continue
        val area = fillIsland(x, y, width, x0, x1, y0, y1, cap, true)
        if (area !in 1..cap) continue
        if (edgeTotal < 4 || edgeBright < edgeTotal * config.clothIslandBrightEdge) continue
        clearIsland(x, y, width, x0, x1, y0, y1)
      }
    }
  }

  /**
   * Span fill of the cloth region containing (x, y), marking [peakMask].
   * Stops and returns [limit] + 1 once the region is bigger than [limit], which
   * is what keeps this linear over the frame however the cloth is shaped.
   */
  private fun fillIsland(
    x: Int, y: Int, width: Int, x0: Int, x1: Int, y0: Int, y1: Int, limit: Int,
    countEdges: Boolean
  ): Int {
    var top = pushClothSpan(x, y, width, x0, x1, 0)
    var area = 0
    edgeTotal = 0
    edgeBright = 0
    while (top > 0) {
      val cy = stack[--top]
      val cx2 = stack[--top]
      val cx1 = stack[--top]
      area += cx2 - cx1 + 1
      if (area > limit) return limit + 1
      if (countEdges) countIslandEdge(cx1, cx2, cy, width, x0, x1, y0, y1)
      var side = 0
      while (side < 2) {
        val ny = if (side == 0) cy - 1 else cy + 1
        side++
        if (ny < y0 || ny > y1) continue
        val base = ny * width
        var sx = cx1
        while (sx <= cx2) {
          if (cloth[base + sx] && !peakMask[base + sx]) {
            if (top + 3 > stack.size) return limit + 1
            top = pushClothSpan(sx, ny, width, x0, x1, top)
            var e = sx
            while (e + 1 <= x1 && peakMask[base + e + 1]) e++
            sx = e + 1
          } else {
            sx++
          }
        }
      }
    }
    return area
  }

  /** Running tally of what the island being filled is surrounded by. */
  private var edgeTotal = 0
  private var edgeBright = 0
  private var edgeModel: ClothModel? = null

  /** Counts the not-cloth neighbours of one span, and how many are lit. */
  private fun countIslandEdge(
    cx1: Int, cx2: Int, cy: Int, width: Int, x0: Int, x1: Int, y0: Int, y1: Int
  ) {
    val m = edgeModel ?: return
    val base = cy * width
    if (cx1 > x0 && !cloth[base + cx1 - 1]) {
      edgeTotal++
      if (isBright(base + cx1 - 1, m)) edgeBright++
    }
    if (cx2 < x1 && !cloth[base + cx2 + 1]) {
      edgeTotal++
      if (isBright(base + cx2 + 1, m)) edgeBright++
    }
    var side = 0
    while (side < 2) {
      val ny = if (side == 0) cy - 1 else cy + 1
      side++
      if (ny < y0 || ny > y1) continue
      val row = ny * width
      for (x in cx1..cx2) {
        if (cloth[row + x]) continue
        edgeTotal++
        if (isBright(row + x, m)) edgeBright++
      }
    }
  }

  private fun pushClothSpan(x: Int, y: Int, width: Int, x0: Int, x1: Int, topIn: Int): Int {
    val base = y * width
    var a = x
    while (a > x0 && cloth[base + a - 1] && !peakMask[base + a - 1]) a--
    var b = x
    while (b < x1 && cloth[base + b + 1] && !peakMask[base + b + 1]) b++
    for (i in a..b) peakMask[base + i] = true
    var top = topIn
    stack[top++] = a
    stack[top++] = b
    stack[top++] = y
    return top
  }

  /** Second pass over an island now that it is known to be small enough. */
  private fun clearIsland(x: Int, y: Int, width: Int, x0: Int, x1: Int, y0: Int, y1: Int) {
    var top = 0
    stack[top++] = x
    stack[top++] = y
    cloth[y * width + x] = false
    while (top > 0) {
      val cy = stack[--top]
      val cx = stack[--top]
      var k = 0
      while (k < 4) {
        val nx = cx + if (k == 0) -1 else if (k == 1) 1 else 0
        val ny = cy + if (k == 2) -1 else if (k == 3) 1 else 0
        k++
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue
        val j = ny * width + nx
        if (!cloth[j] || !peakMask[j]) continue
        cloth[j] = false
        if (top + 2 > stack.size) return
        stack[top++] = nx
        stack[top++] = ny
      }
    }
  }

  private fun isBright(index: Int, m: ClothModel): Boolean {
    val p = pixels[index]
    val r = (p shr 16) and 0xFF
    val g = (p shr 8) and 0xFF
    val b = p and 0xFF
    return (2 * r + 5 * g + b) / 8f > m.yHi
  }

  /** Parses `#RRGGBB` into r, g, b, or null when it is not one. */
  private fun parseCloth(text: String?): IntArray? {
    val s = text?.trim()?.removePrefix("#") ?: return null
    if (s.length != 6) return null
    return try {
      val v = s.toInt(16)
      intArrayOf((v shr 16) and 0xFF, (v shr 8) and 0xFF, v and 0xFF)
    } catch (e: NumberFormatException) {
      null
    }
  }

  /**
   * Builds a model around one colour, with bands wide enough for a cloth whose
   * spread has not been measured. Used only for the manual override, where the
   * user has given a colour and nothing else.
   */
  private fun fixedCloth(r: Int, g: Int, b: Int, config: CaptureConfig): ClothModel? {
    val y0 = (2 * r + 5 * g + b) / 8f
    if (y0 < 6f) return null
    val mean = (r + g + b) / 3f
    val qr = r - mean
    val qg = g - mean
    val qb = b - mean
    val n0 = sqrt(qr * qr + qg * qg + qb * qb)
    val neutral = n0 < NEUTRAL_CHROMA
    val inv = if (neutral) 0f else 1f / n0
    return ClothModel(
      r0 = r, g0 = g, b0 = b,
      ur = qr * inv, ug = qg * inv, ub = qb * inv,
      chroma = n0, luma = y0, neutral = neutral,
      hueAbs = config.clothHueTolerance.toFloat(),
      hueRatio = config.clothHueToleranceRatio.toFloat(),
      projLoBall = 0.20f * n0, projLoRect = 0.30f * n0, projHi = 1.60f * n0,
      yLoBall = 0.28f * y0, yLoRect = 0.34f * y0, yHi = 2.60f * y0,
      guideMinValue = config.guideMinValue.toFloat(),
      guideMaxSaturation = config.guideMaxSaturation.toFloat()
    )
  }

  /**
   * Works out what the cloth on screen looks like.
   *
   * Sample a grid over the middle of the frame, which is where the table is,
   * and take the robust middle of it as the hue. Balls, the guideline and the
   * watermark the game prints on the felt are all minorities of that sample, so
   * the median lands on cloth.
   *
   * The bands around it are then measured rather than assumed, because the
   * spread differs several fold between skins — but *how far down* the floor
   * should go cannot be measured from the sample alone, and it is the one
   * number that decides whether the mask stops at the cushion or runs on across
   * the rail. So several floors are tried and the answer is chosen by what it
   * produces: a rectangle shaped like a pool table, holding as much cloth as
   * any of the candidates manage. The table's proportions are the one thing
   * about the frame that is known exactly, which makes them the honest thing to
   * judge a guess by.
   *
   * Three rounds, because the first sample box is a guess at where the table is
   * and each round hands the next one the rectangle it found.
   */
  private fun learnCloth(width: Int, height: Int, config: CaptureConfig): ClothModel? {
    var bx0 = (width * 0.27).toInt()
    var by0 = (height * 0.30).toInt()
    var bx1 = (width * 0.73).toInt()
    var by1 = (height * 0.70).toInt()
    var best: ClothModel? = null

    for (round in 0 until LEARN_ROUNDS) {
      val n = sampleBox(width, bx0, by0, bx1, by1)
      if (n < 200) return best

      val base = robustCentre(n) ?: return best
      val r0 = base[0]
      val g0 = base[1]
      val b0 = base[2]
      val y0 = (2 * r0 + 5 * g0 + b0) / 8f
      if (y0 < 6f) return best

      val mean = (r0 + g0 + b0) / 3f
      val n0 = sqrt(
        (r0 - mean) * (r0 - mean) + (g0 - mean) * (g0 - mean) + (b0 - mean) * (b0 - mean)
      )
      val neutral = n0 < NEUTRAL_CHROMA
      val inv = if (neutral) 0f else 1f / n0
      val ur = (r0 - mean) * inv
      val ug = (g0 - mean) * inv
      val ub = (b0 - mean) * inv
      val hueAbs = config.clothHueTolerance.toFloat()
      val hueRatio = config.clothHueToleranceRatio.toFloat()

      // Split every sample into hue offset, distance along the hue, and
      // brightness, then keep the ones that could plausibly be cloth. Balls,
      // rails and the black inside a pocket all fail here, and it matters that
      // they do: they would otherwise set the very bands that are meant to
      // exclude them.
      var kept = 0
      for (i in 0 until n) {
        val r = sampleR[i]
        val g = sampleG[i]
        val b = sampleB[i]
        val y = (2 * r + 5 * g + b) / 8f
        if (y < y0 * 0.22f) continue
        val m = (r + g + b) / 3f
        val qr = r - m
        val qg = g - m
        val qb = b - m
        val mag = sqrt(qr * qr + qg * qg + qb * qb)
        val proj = if (neutral) 0f else qr * ur + qg * ug + qb * ub
        val perpSq = mag * mag - proj * proj
        val perp = if (perpSq > 0f) sqrt(perpSq) else 0f
        if (neutral) {
          if (mag > 22f) continue
        } else {
          if (perp > 0.45f * max(mag, 1f)) continue
          if (proj < 0.22f * n0) continue
        }
        projBuf[kept] = proj
        perpBuf[kept] = max(perp - hueRatio * mag, 0f)
        lumaBuf[kept] = y
        val hi = max(r, max(g, b))
        val lo = min(r, min(g, b))
        satBuf[kept] = (hi - lo).toFloat() / max(hi, 1)
        peakBuf[kept] = hi.toFloat()
        kept++
      }
      if (kept < 60) return best

      val perpAbs = clamp(percentile(perpBuf, kept, 0.97f) * 1.3f, hueAbs, hueAbs + 12f)
      val projFloorRaw = if (neutral) 0f else percentile(projBuf, kept, 0.03f)
      val projHi =
        if (neutral) 0f
        else clamp(percentile(projBuf, kept, 0.98f) * 1.22f, 1.15f * n0, 2.2f * n0)
      val yFloorRaw = percentile(lumaBuf, kept, 0.03f)
      val yHi = clamp(percentile(lumaBuf, kept, 0.98f) * 1.30f, 1.3f * y0, 3.0f * y0)

      // The guideline is whatever the felt is not: washed out where the cloth
      // holds its colour, and never much darker than the cloth it crosses.
      // Half the cloth's least colourful reading leaves room for the tint the
      // game puts on the line without letting the felt itself through.
      val guideSat = clamp(
        percentile(satBuf, kept, 0.03f) * 0.55f,
        0.10f,
        config.guideMaxSaturation.toFloat()
      )
      val guideValue = max(
        config.guideMinValue.toFloat(),
        percentile(peakBuf, kept, 0.50f) * GUIDE_VALUE_OF_CLOTH
      )

      val hw = (width + 1) / 2
      val hh = (height + 1) / 2
      var bestScore = -1f
      var bestFallback = Float.MAX_VALUE
      var chosen: ClothModel? = null
      var fallback: ClothModel? = null
      var chosenRect: IntRect? = null
      var fallbackRect: IntRect? = null

      for (tau in RECT_FLOORS) {
        val candidate = ClothModel(
          r0 = r0, g0 = g0, b0 = b0,
          ur = ur, ug = ug, ub = ub,
          chroma = n0, luma = y0, neutral = neutral,
          hueAbs = perpAbs, hueRatio = hueRatio,
          projLoBall = clamp(projFloorRaw * BALL_FLOOR, 0.10f * n0, 0.60f * n0),
          projLoRect = clamp(projFloorRaw * tau, 0.10f * n0, 0.60f * n0),
          projHi = projHi,
          yLoBall = clamp(yFloorRaw * (0.35f + 0.30f * BALL_FLOOR), 0.12f * y0, 0.55f * y0),
          yLoRect = clamp(yFloorRaw * (0.35f + 0.30f * tau), 0.12f * y0, 0.55f * y0),
          yHi = yHi,
          guideMinValue = guideValue,
          guideMaxSaturation = guideSat
        )

        val covered = markHalfTight(candidate, width, height)
        seedX = (bx0 + bx1) / 4
        seedY = (by0 + by1) / 4
        val rect = findPlayfield(width, height) ?: continue
        val w = (rect.right - rect.left).toFloat()
        val h = (rect.bottom - rect.top).toFloat()
        if (w < 80f || h < 40f) continue
        val aspect = w / h
        val fraction = covered.toFloat() / (hw * hh)

        val off = abs(aspect - TARGET_ASPECT)
        if (off <= ASPECT_SLACK && fraction in 0.15f..0.65f) {
          // Among the shapes that could be a table, the one that keeps the most
          // cloth. Tightening the floor past that point only starts eating the
          // shaded felt at the rails, which is where the balls are hardest to
          // find.
          if (fraction > bestScore) {
            bestScore = fraction
            chosen = candidate
            chosenRect = rect
          }
        } else if (off < bestFallback) {
          bestFallback = off
          fallback = candidate
          fallbackRect = rect
        }
      }

      val winner = chosen ?: fallback ?: return best
      val winnerRect = chosenRect ?: fallbackRect ?: return best
      best = winner

      val iw = winnerRect.right - winnerRect.left
      val ih = winnerRect.bottom - winnerRect.top
      bx0 = winnerRect.left + iw / 32
      by0 = winnerRect.top + ih / 32
      bx1 = winnerRect.right - iw / 32
      by1 = winnerRect.bottom - ih / 32
      if (bx1 - bx0 < 40 || by1 - by0 < 20) return best
    }
    return best
  }

  /** Fills [halfTight] from a candidate model. Returns how many pixels it set. */
  private fun markHalfTight(m: ClothModel, width: Int, height: Int): Int {
    val lut = m.lut
    val hw = (width + 1) / 2
    val hh = (height + 1) / 2
    var count = 0
    for (hy in 0 until hh) {
      val base = (hy * 2) * width
      val out = hy * hw
      for (hx in 0 until hw) {
        val p = pixels[base + hx * 2]
        val on = lut[
          (((p shr 19) and 0x1F) shl 10) or
            (((p shr 11) and 0x1F) shl 5) or
            ((p shr 3) and 0x1F)
        ].toInt() > 1
        halfTight[out + hx] = on
        if (on) count++
      }
    }
    return count
  }

  /** Grid sample of one box into the sample buffers. Returns how many landed. */
  private fun sampleBox(width: Int, x0: Int, y0: Int, x1: Int, y1: Int): Int {
    val w = x1 - x0
    val h = y1 - y0
    if (w < 8 || h < 8) return 0
    // Aim for a couple of thousand samples whatever the box size: enough for a
    // stable third percentile, cheap enough to redo fifteen times a learn.
    val step = max(1, sqrt((w.toDouble() * h) / LEARN_SAMPLES).roundToInt())
    var n = 0
    var y = y0
    while (y < y1 && n < MAX_SAMPLES) {
      val base = y * width
      var x = x0
      while (x < x1 && n < MAX_SAMPLES) {
        val p = pixels[base + x]
        sampleR[n] = (p shr 16) and 0xFF
        sampleG[n] = (p shr 8) and 0xFF
        sampleB[n] = p and 0xFF
        n++
        x += step
      }
      y += step
    }
    return n
  }

  /**
   * The middle of the sampled colours: per-channel median, then the mean of
   * everything close to it.
   *
   * The median on its own can name a colour that is not in the sample at all
   * when the channels disagree about where the middle is, and the mean on its
   * own is dragged by whatever bright ball happens to be lying there. Together
   * they land on the cloth.
   */
  private fun robustCentre(n: Int): IntArray? {
    val mr = medianOf(sampleR, n)
    val mg = medianOf(sampleG, n)
    val mb = medianOf(sampleB, n)
    var sr = 0L
    var sg = 0L
    var sb = 0L
    var count = 0
    for (i in 0 until n) {
      if (abs(sampleR[i] - mr) > 45) continue
      if (abs(sampleG[i] - mg) > 45) continue
      if (abs(sampleB[i] - mb) > 45) continue
      sr += sampleR[i]
      sg += sampleG[i]
      sb += sampleB[i]
      count++
    }
    if (count < 20) return intArrayOf(mr, mg, mb)
    return intArrayOf((sr / count).toInt(), (sg / count).toInt(), (sb / count).toInt())
  }

  private fun medianOf(values: IntArray, count: Int): Int {
    val copy = values.copyOf(count)
    copy.sort()
    return copy[count / 2]
  }

  private fun percentile(values: FloatArray, count: Int, q: Float): Float {
    System.arraycopy(values, 0, sortBuf, 0, count)
    Arrays.sort(sortBuf, 0, count)
    val at = ((count - 1) * q).roundToInt().coerceIn(0, count - 1)
    return sortBuf[at]
  }

  private fun clamp(v: Float, lo: Float, hi: Float) = if (v < lo) lo else if (v > hi) hi else v

  // -- Playfield -------------------------------------------------------------

  private class IntRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    fun toScreen(k: Float) = floatArrayOf(left * k, top * k, right * k, bottom * k)
  }

  /**
   * Median first/last cloth pixel per scanline, over the cloth region connected
   * to the middle of the table.
   *
   * Two ideas, and both are load-bearing.
   *
   * The median is what makes the reading exact rather than approximate: pocket
   * mouths and balls resting against a cushion only disturb a minority of the
   * lines, so the middle value lands on the cushion face itself. Measured
   * against the reference frames this reproduces the calibrated rectangle to
   * the pixel.
   *
   * Insisting the cloth be *connected to the table* is what makes it survive a
   * skin the colour of the app's own chrome — which the blue one is, almost
   * exactly. Colour alone cannot separate those two, and without this the
   * rectangle grows to the whole screen whenever the player picks that table.
   * The rail runs between them and answers no colour test at all, so the fill
   * stops there.
   *
   * Run at half resolution. The rectangle is wanted to a pixel or two out of a
   * thousand, and the fill costs a quarter as much there.
   */
  private fun findPlayfield(width: Int, height: Int): IntRect? {
    val hw = (width + 1) / 2
    val hh = (height + 1) / 2
    if (fillPlayfieldRegion(hw, hh) <= 64) return null

    var rows = 0
    for (y in 0 until hh) {
      var first = -1
      var last = -1
      var count = 0
      val base = y * hw
      for (x in 0 until hw) {
        if (halfFill[base + x]) {
          if (first < 0) first = x
          last = x
          count++
        }
      }
      if (count > hw / 8) {
        rowFirst[rows] = first
        rowLast[rows] = last
        rows++
      }
    }
    if (rows < 8) return null

    var cols = 0
    for (x in 0 until hw) {
      var first = -1
      var last = -1
      var count = 0
      for (y in 0 until hh) {
        if (halfFill[y * hw + x]) {
          if (first < 0) first = y
          last = y
          count++
        }
      }
      if (count > hh / 8) {
        colFirst[cols] = first
        colLast[cols] = last
        cols++
      }
    }
    if (cols < 8) return null

    // Half-resolution samples come off even rows and columns, so a cloth sample
    // at 2h only says the edge lies within a pixel either side of it. Splitting
    // that both ways keeps the rectangle centred on the truth; taking the
    // sample itself put every edge a pixel low, and a pixel on the cue ball is
    // worth most of a degree of aim.
    val left = median(rowFirst, rows) * 2 - 1
    val right = median(rowLast, rows) * 2 + 1
    val top = median(colFirst, cols) * 2 - 1
    val bottom = median(colLast, cols) * 2 + 1

    if (right - left < 40 || bottom - top < 20) return null
    return IntRect(
      max(left, 0),
      max(top, 0),
      right.coerceAtMost(width - 1),
      bottom.coerceAtMost(height - 1)
    )
  }

  /**
   * Fills the cloth region containing the table, trying several starting points.
   *
   * One starting point is not enough. The obvious one — the middle of the
   * playfield — is exactly where the game draws its guideline and rests the cue
   * ball, and on a full-power shot the cue lies across the whole width there.
   * A seed on any of those is not cloth, and a seed nudged off one lands as
   * easily in a two-pixel gap between the decorations on the cue as on the
   * table. So candidates are spread over the middle of the frame, each has to
   * sit in a solid block of cloth rather than a speck, and the first one that
   * fills a believable area wins.
   */
  private fun fillPlayfieldRegion(hw: Int, hh: Int): Int {
    val want = (hw * hh) / 40
    var best = 0
    var bestX = -1
    var bestY = -1
    var attempts = 0
    val cx = if (seedX in 0 until hw) seedX else hw / 2
    val cy = if (seedY in 0 until hh) seedY else hh / 2

    for (i in SEED_OFFSETS.indices step 2) {
      val sx = cx + (hw * SEED_OFFSETS[i]) / 100
      val sy = cy + (hh * SEED_OFFSETS[i + 1]) / 100
      if (sx < 3 || sy < 3 || sx >= hw - 3 || sy >= hh - 3) continue
      if (!solidCloth(sx, sy, hw)) continue
      val filled = fillFrom(sx, sy, hw, hh)
      if (filled > best) {
        best = filled
        bestX = sx
        bestY = sy
      }
      if (filled >= want) return filled
      // Each attempt is a pass over a good part of the frame; a handful is the
      // most this is worth before admitting the table is not there.
      if (++attempts >= MAX_SEED_ATTEMPTS) break
    }
    // None of them filled a believable area, so the best of a bad set stands —
    // but `halfFill` currently holds whichever was tried *last*. Everything
    // downstream reads that mask, so put the one being reported back into it.
    if (best > 0 && bestX >= 0) fillFrom(bestX, bestY, hw, hh)
    return best
  }

  /** True when a 5x5 block around the point is all cloth. */
  private fun solidCloth(x: Int, y: Int, hw: Int): Boolean {
    for (dy in -2..2) {
      val base = (y + dy) * hw
      for (dx in -2..2) if (!halfTight[base + x + dx]) return false
    }
    return true
  }

  /**
   * Span flood fill of [halfTight] into [halfFill]. Returns the area filled.
   *
   * Spans rather than single pixels: the stack has to hold the frontier, and a
   * pixel-at-a-time fill of a quarter-million cells does not fit in any buffer
   * worth allocating, while one entry per horizontal run is a few thousand.
   */
  private fun fillFrom(sx: Int, sy: Int, hw: Int, hh: Int): Int {
    Arrays.fill(halfFill, 0, hw * hh, false)
    var top = pushSpan(sx, sy, hw, halfStack, 0)
    var filled = 0
    while (top > 0) {
      val y = halfStack[--top]
      val x2 = halfStack[--top]
      val x1 = halfStack[--top]
      filled += x2 - x1 + 1
      var side = 0
      while (side < 2) {
        val ny = if (side == 0) y - 1 else y + 1
        side++
        if (ny < 0 || ny >= hh) continue
        val base = ny * hw
        var x = x1
        while (x <= x2) {
          if (halfTight[base + x] && !halfFill[base + x]) {
            if (top + 3 > halfStack.size) return filled
            top = pushSpan(x, ny, hw, halfStack, top)
            // pushSpan marked the whole run, so skip past it.
            var e = x
            while (e + 1 < hw && halfFill[base + e + 1]) e++
            x = e + 1
          } else {
            x++
          }
        }
      }
    }
    return filled
  }

  /** Marks the run through (x, y) and pushes it. Returns the new stack top. */
  private fun pushSpan(x: Int, y: Int, hw: Int, out: IntArray, topIn: Int): Int {
    val base = y * hw
    var a = x
    while (a > 0 && halfTight[base + a - 1] && !halfFill[base + a - 1]) a--
    var b = x
    while (b + 1 < hw && halfTight[base + b + 1] && !halfFill[base + b + 1]) b++
    for (i in a..b) halfFill[base + i] = true
    var top = topIn
    out[top++] = a
    out[top++] = b
    out[top++] = y
    return top
  }

  private fun median(values: IntArray, count: Int): Int {
    val copy = values.copyOf(count)
    copy.sort()
    return copy[count / 2]
  }

  // -- Balls -----------------------------------------------------------------

  /**
   * Chamfer 3-4 distance transform of the not-cloth region inside the
   * playfield, in thirds of a pixel.
   *
   * Everything cloth, and everything outside the playfield, seeds the transform
   * at zero, so the rails need no special case: a ball resting on a cushion
   * still peaks at its own centre.
   */
  private fun distanceTransform(width: Int, height: Int, rect: IntRect, cap: Int) {
    Arrays.fill(distance, 0, width * height, 0)

    // Leave a one pixel apron so the passes below can read their neighbours
    // unconditionally.
    val x0 = max(rect.left, 1)
    val x1 = min(rect.right, width - 2)
    val y0 = max(rect.top, 1)
    val y1 = min(rect.bottom, height - 2)
    if (x1 <= x0 || y1 <= y0) return

    val inf = Int.MAX_VALUE / 4
    for (y in y0..y1) {
      val base = y * width
      for (x in x0..x1) {
        if (!cloth[base + x]) distance[base + x] = inf
      }
    }

    for (y in y0..y1) {
      val base = y * width
      val up = base - width
      for (x in x0..x1) {
        val i = base + x
        if (distance[i] == 0) continue
        var d = distance[i]
        d = min(d, distance[up + x - 1] + 4)
        d = min(d, distance[up + x] + 3)
        d = min(d, distance[up + x + 1] + 4)
        d = min(d, distance[i - 1] + 3)
        distance[i] = d
      }
    }

    for (y in y1 downTo y0) {
      val base = y * width
      val down = base + width
      for (x in x1 downTo x0) {
        val i = base + x
        if (distance[i] == 0) continue
        var d = distance[i]
        d = min(d, distance[down + x + 1] + 4)
        d = min(d, distance[down + x] + 3)
        d = min(d, distance[down + x - 1] + 4)
        d = min(d, distance[i + 1] + 3)
        distance[i] = if (d > cap) cap else d
      }
    }
  }

  private fun findBalls(
    width: Int,
    height: Int,
    rect: IntRect,
    ballRadius: Float,
    config: CaptureConfig
  ): List<DetectedBall> {
    // Chamfer 3-4 counts an orthogonal step as 3, so a radius in pixels is
    // three times that in transform units.
    val cap = (ballRadius * config.maxDistanceRadii * 3.0).roundToInt().coerceAtLeast(3)
    distanceTransform(width, height, rect, cap)

    val threshold = (ballRadius * config.ballPeakRatio * 3.0).roundToInt().coerceAtLeast(3)
    val x0 = max(rect.left, 1)
    val x1 = min(rect.right, width - 2)
    val y0 = max(rect.top, 1)
    val y1 = min(rect.bottom, height - 2)
    if (x1 <= x0 || y1 <= y0) return emptyList()

    // Mark every pixel that is at least as deep as everything within a ball
    // separation of it. Because the transform is clamped, a ball's centre comes
    // out as a small flat top rather than a single pixel, and neighbouring balls
    // stay separate as long as the depth dips between them - which it does
    // wherever any cloth or any dark rim shows through.
    val separation = (ballRadius * config.ballSeparationRadii).roundToInt().coerceAtLeast(1)
    Arrays.fill(peakMask, 0, width * height, false)
    for (y in y0..y1) {
      val base = y * width
      for (x in x0..x1) {
        val d = distance[base + x]
        if (d < threshold) continue
        if (isLocalMax(x, y, d, separation, width, height)) peakMask[base + x] = true
      }
    }

    val exclusion = ballRadius * config.pocketExclusionRadii.toFloat()
    val pockets = pocketCenters(rect)
    // A flat top bigger than a ball's face is a merged group or a ridge along
    // the cue stick, not a ball.
    val maxTop = Math.PI * (ballRadius * 1.1) * (ballRadius * 1.1)
    val fillRadius = ballRadius * 0.85f
    val minFill = config.ballMinFill.toFloat()

    val peakX = FloatArray(MAX_PEAKS)
    val peakY = FloatArray(MAX_PEAKS)
    val peakDepth = IntArray(MAX_PEAKS)
    var peaks = 0

    for (y in y0..y1) {
      if (peaks >= MAX_PEAKS) break
      val base = y * width
      for (x in x0..x1) {
        if (peaks >= MAX_PEAKS) break
        if (!peakMask[base + x]) continue

        // Read the depth before the fill consumes the mask. Every pixel of a
        // flat top is at the same depth, so the seed's stands for all of them.
        val depth = distance[base + x]
        val blob = floodFill(base + x, width, x0, x1, y0, y1)
        if (blob.area <= 0 || blob.area > maxTop) continue
        // It reached the clamp, so it is a region much larger than a ball: the
        // cue stick, a HUD panel, or the wood behind a pocket.
        if (depth >= cap) continue

        val w = blob.maxX - blob.minX + 1
        val h = blob.maxY - blob.minY + 1
        if (max(w, h).toFloat() / max(1, min(w, h)) > 3f) continue

        val rx = blob.sumX.toFloat() / blob.area
        val ry = blob.sumY.toFloat() / blob.area

        var inPocket = false
        for (i in pockets.indices) {
          // Side pockets are cut shallower than corners, so their notch is
          // smaller and a ball can legitimately rest closer to one.
          val r = if (i == 1 || i == 4) exclusion * 0.85f else exclusion
          val dx = rx - pockets[i].first
          val dy = ry - pockets[i].second
          if (dx * dx + dy * dy < r * r) { inPocket = true; break }
        }
        if (inPocket) continue

        // The test that separates a ball from everything else shaped like one.
        if (discFill(rx, ry, fillRadius, width, height) < minFill) continue

        peakX[peaks] = rx
        peakY[peaks] = ry
        peakDepth[peaks] = depth
        peaks++
      }
    }

    // Greedy suppression, deepest first. The local-maximum window only rejects
    // pixels that are *strictly* deeper, so two plateaus of equal depth a radius
    // apart both survive it and one ball gets reported twice.
    val separationSq = (ballRadius * config.ballSeparationRadii.toFloat()).let { it * it }
    val cx = FloatArray(MAX_BALLS)
    val cy = FloatArray(MAX_BALLS)
    var found = 0

    while (found < MAX_BALLS) {
      var best = -1
      for (i in 0 until peaks) {
        if (peakDepth[i] >= 0 && (best < 0 || peakDepth[i] > peakDepth[best])) best = i
      }
      if (best < 0) break
      peakDepth[best] = -1

      var suppressed = false
      for (j in 0 until found) {
        val dx = peakX[best] - cx[j]
        val dy = peakY[best] - cy[j]
        if (dx * dx + dy * dy < separationSq) { suppressed = true; break }
      }
      if (suppressed) continue

      cx[found] = peakX[best]
      cy[found] = peakY[best]
      found++
    }

    // Centres so far are flat-top centroids, good to about a pixel. Re-place them
    // on their own rims, which is worth roughly two degrees of object-ball aim.
    if (config.refineBallCenters) {
      val fit = FloatArray(3)
      for (j in 0 until found) {
        if (refineBallCenter(cx[j], cy[j], ballRadius, width, height, config, fit)) {
          cx[j] = fit[0]
          cy[j] = fit[1]
        }
      }
    }

    Arrays.fill(ballMask, 0, width * height, false)
    val out = ArrayList<DetectedBall>(found)
    val whiteness = FloatArray(found)
    val saturation = FloatArray(found)
    for (j in 0 until found) {
      readFace(cx[j], cy[j], ballRadius, width, height, config)
      whiteness[j] = faceWhite
      saturation[j] = faceSaturated
      out.add(classify(cx[j], cy[j], ballRadius, config))
      stampBall(cx[j], cy[j], ballRadius, width, height)
    }
    return promoteCueBall(out, whiteness, saturation, config)
  }

  /**
   * Fraction of the disc at ([cx], [cy]) that is not cloth.
   *
   * A ball fills its own disc completely whatever its colour. Everything else
   * the distance transform peaks on — a ridge along the cue stick, a sliver of
   * HUD, a cushion notch — is deep in one direction only, and cloth shows
   * through the rest of the disc.
   */
  private fun discFill(cx: Float, cy: Float, radius: Float, width: Int, height: Int): Float {
    val rSq = radius * radius
    val x0 = max((cx - radius).toInt(), 0)
    val x1 = min((cx + radius).toInt() + 1, width - 1)
    val y0 = max((cy - radius).toInt(), 0)
    val y1 = min((cy + radius).toInt() + 1, height - 1)

    var total = 0
    var solid = 0
    for (y in y0..y1) {
      val dy = y - cy
      val base = y * width
      for (x in x0..x1) {
        val dx = x - cx
        if (dx * dx + dy * dy > rSq) continue
        total++
        if (!cloth[base + x]) solid++
      }
    }
    // Too close to an edge to judge: treat as unproven rather than as a ball.
    return if (total < 8) 0f else solid.toFloat() / total
  }

  /** True when nothing within [radius] of this pixel is strictly deeper. */
  private fun isLocalMax(
    x: Int,
    y: Int,
    depth: Int,
    radius: Int,
    width: Int,
    height: Int
  ): Boolean {
    val x0 = max(x - radius, 0)
    val x1 = min(x + radius, width - 1)
    val y0 = max(y - radius, 0)
    val y1 = min(y + radius, height - 1)
    for (yy in y0..y1) {
      val base = yy * width
      for (xx in x0..x1) {
        if (distance[base + xx] > depth) return false
      }
    }
    return true
  }

  private class Blob {
    var area = 0
    var sumX = 0L
    var sumY = 0L
    var minX = 0
    var maxX = 0
    var minY = 0
    var maxY = 0
  }

  private val blob = Blob()

  /**
   * Consumes the connected flat top containing [seed], four-connected.
   *
   * Every visited pixel is cleared from the mask, so the caller's raster scan
   * meets each top exactly once.
   */
  private fun floodFill(seed: Int, width: Int, x0: Int, x1: Int, y0: Int, y1: Int): Blob {
    val b = blob
    b.area = 0
    b.sumX = 0
    b.sumY = 0
    val sy = seed / width
    val sx = seed - sy * width
    b.minX = sx; b.maxX = sx; b.minY = sy; b.maxY = sy

    var top = 0
    stack[top++] = seed
    peakMask[seed] = false

    while (top > 0) {
      val i = stack[--top]
      val y = i / width
      val x = i - y * width

      b.area++
      b.sumX += x
      b.sumY += y
      if (x < b.minX) b.minX = x
      if (x > b.maxX) b.maxX = x
      if (y < b.minY) b.minY = y
      if (y > b.maxY) b.maxY = y

      if (top + 4 > stack.size) continue
      if (x > x0 && peakMask[i - 1]) { peakMask[i - 1] = false; stack[top++] = i - 1 }
      if (x < x1 && peakMask[i + 1]) { peakMask[i + 1] = false; stack[top++] = i + 1 }
      if (y > y0 && peakMask[i - width]) { peakMask[i - width] = false; stack[top++] = i - width }
      if (y < y1 && peakMask[i + width]) { peakMask[i + width] = false; stack[top++] = i + width }
    }
    return b
  }

  /** Marks a ball's face so the aim fit skips over it. */
  private fun stampBall(cx: Float, cy: Float, ballRadius: Float, width: Int, height: Int) {
    // Slightly proud of the ball, to cover the rim highlight as well as the face.
    val r = ballRadius * 1.12f
    val rSq = r * r
    val x0 = max((cx - r).toInt(), 0)
    val x1 = min((cx + r).toInt(), width - 1)
    val y0 = max((cy - r).toInt(), 0)
    val y1 = min((cy + r).toInt(), height - 1)
    for (y in y0..y1) {
      val dy = y - cy
      val base = y * width
      for (x in x0..x1) {
        val dx = x - cx
        if (dx * dx + dy * dy <= rSq) ballMask[base + x] = true
      }
    }
  }

  private var faceWhite = 0f
  private var faceDark = 0f
  private var faceSaturated = 0f

  /**
   * Reads a ball's face from the original pixels into [faceWhite], [faceDark]
   * and [faceSaturated].
   *
   * Sampling a disc around the detected centre rather than the shape that was
   * detected keeps the reading honest when part of the ball is under a drawn
   * line: the line costs a few samples, not the whole classification.
   */
  private fun readFace(
    cx: Float,
    cy: Float,
    ballRadius: Float,
    width: Int,
    height: Int,
    config: CaptureConfig
  ) {
    val r = ballRadius * config.classifyRadii.toFloat()
    val rSq = r * r
    val x0 = max((cx - r).toInt(), 0)
    val x1 = min((cx + r).toInt(), width - 1)
    val y0 = max((cy - r).toInt(), 0)
    val y1 = min((cy + r).toInt(), height - 1)

    var samples = 0
    var white = 0
    var dark = 0
    var saturated = 0
    for (y in y0..y1) {
      val dy = y - cy
      val base = y * width
      for (x in x0..x1) {
        val dx = x - cx
        if (dx * dx + dy * dy > rSq) continue
        val p = pixels[base + x]
        val pr = (p shr 16) and 0xFF
        val pg = (p shr 8) and 0xFF
        val pb = p and 0xFF
        val lo = min(pr, min(pg, pb))
        val hi = max(pr, max(pg, pb))
        samples++
        // White means bright *and* neutral, which the cream cue ball and the
        // number patches satisfy but a saturated ball never does.
        if (lo >= 165 && hi - lo <= 45) white++
        if (hi < 95) dark++
        if (hi - lo > 55) saturated++
      }
    }
    if (samples == 0) {
      faceWhite = 0f
      faceDark = 0f
      faceSaturated = 1f
      return
    }
    faceWhite = white.toFloat() / samples
    faceDark = dark.toFloat() / samples
    faceSaturated = saturated.toFloat() / samples
  }

  /** Turns the last [readFace] into a class. Never returns "cue". */
  private fun classify(
    cx: Float,
    cy: Float,
    ballRadius: Float,
    config: CaptureConfig
  ): DetectedBall = when {
    faceDark > config.eightMinDark ->
      DetectedBall(cx, cy, ballRadius, "eight", faceDark)
    faceWhite > config.stripeMinWhite ->
      DetectedBall(cx, cy, ballRadius, "stripe", faceWhite)
    else ->
      DetectedBall(cx, cy, ballRadius, "solid", 1f - faceWhite)
  }

  /**
   * Promotes the least colourful bright face to cue ball.
   *
   * Whiteness alone gets this wrong, which is worth spelling out because the
   * whole overlay hangs off it. A striped ball is a white band with a coloured
   * ring, so across the middle of its face it reads whiter than the cream cue
   * ball does — pick by whiteness and a stripe wins whenever the cue stick
   * shades the real cue ball. Colour is the honest signal: over the full disc
   * the cue ball carries almost no saturated pixels and every other ball
   * carries a fifth of a face or more. The whiteness floor stays on to separate
   * the cue ball from the eight, which is just as unsaturated but black.
   */
  private fun promoteCueBall(
    balls: List<DetectedBall>,
    whiteness: FloatArray,
    saturation: FloatArray,
    config: CaptureConfig
  ): List<DetectedBall> {
    var best = -1
    var bestSaturation = config.cueMaxSaturation.toFloat()
    for (i in balls.indices) {
      if (whiteness[i] < config.cueMinWhite) continue
      if (saturation[i] < bestSaturation) {
        bestSaturation = saturation[i]
        best = i
      }
    }
    if (best < 0) return balls
    return balls.mapIndexed { i, b ->
      if (i == best) DetectedBall(b.x, b.y, b.radius, "cue", whiteness[i]) else b
    }
  }

  private fun pocketCenters(rect: IntRect): List<Pair<Float, Float>> {
    val midX = (rect.left + rect.right) / 2f
    return listOf(
      rect.left.toFloat() to rect.top.toFloat(),
      midX to rect.top.toFloat(),
      rect.right.toFloat() to rect.top.toFloat(),
      rect.left.toFloat() to rect.bottom.toFloat(),
      midX to rect.bottom.toFloat(),
      rect.right.toFloat() to rect.bottom.toFloat()
    )
  }

  // -- Aim line --------------------------------------------------------------

  /** A fitted guideline: which way it points and how far it runs. */
  private class Aim(val angle: Float, val reach: Float)

  /**
   * Fits the game's own guideline as a line through the cue ball centre.
   *
   * Every lit pixel casts one distance-weighted vote for the angle it subtends
   * at the cue ball. Voting is undirected, over half a turn, because the cue
   * stick lies on the same axis as the guideline and both halves should
   * reinforce a single estimate of it. Weighting by distance is what buys the
   * precision — a pixel 500 px out fixes the angle forty times more tightly
   * than one at 12 — but it also lets a far-off scatter of HUD highlights
   * outscore a real line, so the top peaks are all tried and each is checked
   * for being an actual stroke: a run that *starts at the cue ball*, continues
   * without a break, and stays lit along its whole length. That first condition
   * does most of the work. Coincidental alignments look convincing on every
   * other measure, but they do not reach back to the ball the line is drawn
   * from.
   *
   * Returns null whenever the game is not drawing a guideline — during ball
   * motion, between shots, and in ball-in-hand — which is a normal state, not a
   * failure, and the caller holds its last reading through it.
   */
  private fun findAimAngle(
    width: Int,
    rect: IntRect,
    cue: DetectedBall,
    ballRadius: Float,
    config: CaptureConfig
  ): Aim? {
    val lit = collectLitPixels(width, rect, cue, ballRadius, config) ?: return null

    val binDeg = config.aimBinDegrees.coerceIn(0.05, 5.0)
    val bins = (180.0 / binDeg).roundToInt()
    if (votes.size < bins) {
      votes = FloatArray(bins)
      smoothed = FloatArray(bins)
    }
    java.util.Arrays.fill(votes, 0, bins, 0f)

    var sumD = 0.0
    for (i in 0 until lit) {
      var deg = Math.toDegrees(atan2(litV[i].toDouble(), litU[i].toDouble()))
      if (deg < 0) deg += 180.0
      if (deg >= 180.0) deg -= 180.0
      val b = (deg / binDeg).toInt().coerceIn(0, bins - 1)
      votes[b] += litD[i]
      sumD += litD[i]
    }

    // Smooth over the angle a two-and-a-half pixel offset subtends at the mean
    // distance, so a line that is a few pixels wide lands in one peak instead of
    // being split across neighbouring bins.
    val meanD = (sumD / lit).coerceAtLeast(1.0)
    val half = (Math.toDegrees(2.5 / meanD) / binDeg).roundToInt().coerceIn(1, bins / 4)
    for (b in 0 until bins) {
      var acc = 0f
      for (k in -half..half) acc += votes[((b + k) % bins + bins) % bins]
      smoothed[b] = acc
    }

    val separation = (config.aimPeakSeparationDegrees / binDeg).roundToInt().coerceAtLeast(1)
    val maxPeaks = config.aimPeaks.coerceIn(1, 16)
    val chosen = IntArray(maxPeaks)
    var peakCount = 0

    var bestVote = 0f
    var bestAngle = 0f
    var bestReach = 0f

    while (peakCount < maxPeaks) {
      var peak = -1
      var peakVote = 0f
      for (b in 0 until bins) {
        if (smoothed[b] <= peakVote) continue
        var tooClose = false
        for (j in 0 until peakCount) {
          val gap = abs(b - chosen[j])
          if (min(gap, bins - gap) < separation) { tooClose = true; break }
        }
        if (!tooClose) { peak = b; peakVote = smoothed[b] }
      }
      if (peak < 0) break
      chosen[peakCount++] = peak

      var theta = Math.toRadians((peak + 0.5) * binDeg)
      // Total least squares on the pixels near the peak, in a band that narrows
      // each pass. The band widens with distance because a line the fit is a
      // fraction of a degree away from is further off in pixels the further out
      // it is measured, and those far pixels are the ones worth keeping.
      val bandScale = max(1.0, ballRadius / 16.0)
      for (band in doubleArrayOf(6.0, 3.0, 2.0, 2.0)) {
        val limit = band * bandScale
        var suu = 0.0
        var svv = 0.0
        var suv = 0.0
        var kept = 0
        val s = sin(theta)
        val c = cos(theta)
        for (i in 0 until lit) {
          val u = litU[i]
          val v = litV[i]
          if (abs(u * s - v * c) > limit + 0.012 * litD[i]) continue
          val w = litD[i].toDouble()
          suu += w * u * u
          svv += w * v * v
          suv += w * u * v
          kept++
        }
        if (kept < config.aimMinPixels / 2) break
        theta = 0.5 * atan2(2.0 * suv, suu - svv)
      }

      // Undirected so far. The guideline runs one way from the cue ball and the
      // stick the other, and only the drawn run tells them apart.
      val forward = measureRun(lit, theta, ballRadius, config)
      val backward = measureRun(lit, theta + Math.PI, ballRadius, config)
      val pick = if (backward.score > forward.score) backward else forward
      if (backward.score > forward.score) theta += Math.PI

      if (pick.start > ballRadius * config.aimMaxStartRadii) continue
      if (pick.reach < ballRadius * config.aimMinRunRadii) continue
      if (pick.fill < config.aimMinFill) continue

      if (peakVote > bestVote) {
        bestVote = peakVote
        bestAngle = normalizeAngle(theta.toFloat())
        bestReach = pick.reach
      }
    }

    return if (bestVote > 0f) Aim(bestAngle, bestReach) else null
  }

  /**
   * Gathers overlay pixels as offsets from the cue ball centre.
   *
   * Pixels inside a detected ball are dropped: balls carry white highlights and
   * white number patches that would otherwise vote, and a ball sitting on the
   * line would drag the fit toward its own centre. Pixels closer than a ball
   * radius and a bit are dropped too — at that range the angle a pixel subtends
   * is meaningless.
   */
  private fun collectLitPixels(
    width: Int,
    rect: IntRect,
    cue: DetectedBall,
    ballRadius: Float,
    config: CaptureConfig
  ): Int? {
    val area = (rect.right - rect.left) * (rect.bottom - rect.top)
    if (area <= 0) return null
    if (litU.size < area) {
      litU = FloatArray(area)
      litV = FloatArray(area)
      litD = FloatArray(area)
    }

    val nearSq = (ballRadius * 1.15f) * (ballRadius * 1.15f)
    var n = 0
    for (y in rect.top until rect.bottom) {
      val base = y * width
      val dy = y - cue.y
      for (x in rect.left until rect.right) {
        val i = base + x
        if (!guide[i] || ballMask[i]) continue
        val dx = x - cue.x
        val dSq = dx * dx + dy * dy
        if (dSq <= nearSq) continue
        litU[n] = dx
        litV[n] = dy
        litD[n] = sqrt(dSq)
        n++
      }
    }
    return if (n >= config.aimMinPixels) n else null
  }

  private class RunMeasure(val reach: Float, val fill: Float, val start: Float) {
    /** Long and solid beats short and solid, which is how a direction is chosen. */
    val score: Float get() = reach * fill
  }

  private val emptyRun = RunMeasure(0f, 0f, Float.MAX_VALUE)

  /**
   * Walks outward from the cue ball along [theta] and measures the lit run.
   *
   * Distances are bucketed at two pixels rather than counted per pixel, and
   * that detail matters: a digital line at 45 degrees puts its pixels 1.41
   * apart along its own axis while a horizontal one puts them 1.0 apart, so
   * counting distinct distances would score every diagonal at 0.71 and quietly
   * bias the whole detector toward horizontal and vertical lines. A bucket
   * wider than the diagonal spacing removes the bias.
   */
  private fun measureRun(
    lit: Int,
    theta: Double,
    ballRadius: Float,
    config: CaptureConfig
  ): RunMeasure {
    val s = sin(theta)
    val c = cos(theta)
    val bin = 2f
    val bandBase = max(2.0f, 0.16f * ballRadius)

    var maxAlong = 0f
    for (i in 0 until lit) {
      val along = litU[i] * c + litV[i] * s
      if (along > maxAlong) maxAlong = along.toFloat()
    }
    if (maxAlong < bin) return emptyRun

    val slots = (maxAlong / bin).toInt() + 2
    if (runBins.size < slots) runBins = IntArray(slots)
    java.util.Arrays.fill(runBins, 0, slots, 0)

    var total = 0
    for (i in 0 until lit) {
      val u = litU[i]
      val v = litV[i]
      val along = u * c + v * s
      if (along <= 0) continue
      if (abs(u * s - v * c) > bandBase + 0.012 * litD[i]) continue
      runBins[(along / bin).toInt()]++
      total++
    }
    if (total < 4) return emptyRun

    var first = -1
    for (b in 0 until slots) if (runBins[b] > 0) { first = b; break }
    if (first < 0) return emptyRun

    // The gap floor is absolute: anti-aliasing drops the same number of pixels
    // out of a stroke however large the ball happens to be on screen.
    val gapPx = max(config.aimMinGapPixels, config.aimMaxGapRadii * ballRadius)
    val gapBins = (gapPx / bin).toInt().coerceAtLeast(1)

    var last = first
    var occupied = 1
    var idle = 0
    for (b in first + 1 until slots) {
      if (runBins[b] > 0) {
        last = b
        occupied++
        idle = 0
      } else {
        idle++
        if (idle > gapBins) break
      }
    }

    val span = last - first + 1
    return RunMeasure(
      reach = (last + 1) * bin,
      fill = min(1f, occupied.toFloat() / span),
      start = first * bin
    )
  }

  // -- Contact ---------------------------------------------------------------

  /**
   * Signed margin of the cloth test in colour units: positive on cloth, negative
   * on anything sitting on top of it, and zero exactly where the boolean test
   * flips. Interpolating this between two neighbouring pixels puts a ball's rim
   * somewhere between them rather than on one or the other.
   */
  private fun clothMargin(index: Int, m: ClothModel): Float {
    val p = pixels[index]
    return m.margin((p shr 16) and 0xFF, (p shr 8) and 0xFF, p and 0xFF)
  }

  /**
   * Fills [marginBox] with the cloth margin over a window around one ball.
   *
   * The rim fit reads the margin at four corners for every step of every ray,
   * which comes to a couple of hundred thousand evaluations a frame — and each
   * one costs two square roots now that the test is a direction in colour space
   * rather than four integer comparisons. Almost all of them are repeats: the
   * rays fan out from a single centre, so the same pixels are read over and
   * over. Computing the window once first turns that into one evaluation per
   * pixel, and took the fit from four milliseconds a frame back to under one.
   */
  private fun fillMarginBox(
    cx: Float,
    cy: Float,
    reach: Float,
    width: Int,
    height: Int,
    m: ClothModel
  ) {
    marginX0 = max((cx - reach).toInt() - 1, 0)
    marginY0 = max((cy - reach).toInt() - 1, 0)
    marginX1 = min((cx + reach).toInt() + 1, width - 1)
    marginY1 = min((cy + reach).toInt() + 1, height - 1)
    marginW = marginX1 - marginX0 + 1
    val h = marginY1 - marginY0 + 1
    if (marginW <= 0 || h <= 0) {
      marginW = 0
      return
    }
    val need = marginW * h
    if (marginBox.size < need) marginBox = FloatArray(need)
    var at = 0
    for (y in marginY0..marginY1) {
      val base = y * width
      for (x in marginX0..marginX1) marginBox[at++] = clothMargin(base + x, m)
    }
  }

  /**
   * Bilinear sample of the margin window filled by [fillMarginBox]. Returns NaN
   * outside it, which ends the ray.
   */
  private fun clothMarginAt(x: Float, y: Float): Float {
    val x0 = floor(x).toInt()
    val y0 = floor(y).toInt()
    if (marginW <= 0) return Float.NaN
    if (x0 < marginX0 || y0 < marginY0 || x0 + 1 > marginX1 || y0 + 1 > marginY1) {
      return Float.NaN
    }
    val fx = x - x0
    val fy = y - y0
    val i = (y0 - marginY0) * marginW + (x0 - marginX0)
    val m00 = marginBox[i]
    val m10 = marginBox[i + 1]
    val m01 = marginBox[i + marginW]
    val m11 = marginBox[i + marginW + 1]
    return m00 * (1 - fx) * (1 - fy) + m10 * fx * (1 - fy) +
      m01 * (1 - fx) * fy + m11 * fx * fy
  }

  /**
   * Algebraic circle fit over `edgeX`/`edgeY` where `edgeKeep` is set.
   *
   * Kasa's formulation: shifting to the centroid makes the normal equations a
   * plain 2x2 solve rather than anything needing an eigenvector, and with a full
   * circumference of points its bias against short arcs never bites — the
   * rejection passes below are what guarantee the arc stays whole.
   *
   * Writes centre and radius into `out`; returns false if the points are too
   * nearly collinear to define a circle.
   */
  private fun fitCircle(count: Int, out: FloatArray): Boolean {
    var n = 0
    var mx = 0.0
    var my = 0.0
    for (i in 0 until count) {
      if (!edgeKeep[i]) continue
      mx += edgeX[i]
      my += edgeY[i]
      n++
    }
    if (n < 3) return false
    mx /= n
    my /= n

    var suu = 0.0; var svv = 0.0; var suv = 0.0
    var suuu = 0.0; var svvv = 0.0; var suvv = 0.0; var svuu = 0.0
    for (i in 0 until count) {
      if (!edgeKeep[i]) continue
      val u = edgeX[i] - mx
      val v = edgeY[i] - my
      val uu = u * u
      val vv = v * v
      suu += uu; svv += vv; suv += u * v
      suuu += uu * u; svvv += vv * v; suvv += u * vv; svuu += v * uu
    }
    val det = suu * svv - suv * suv
    if (abs(det) < 1e-9) return false
    val c1 = 0.5 * (suuu + suvv)
    val c2 = 0.5 * (svvv + svuu)
    val uc = (c1 * svv - c2 * suv) / det
    val vc = (c2 * suu - c1 * suv) / det

    out[0] = (mx + uc).toFloat()
    out[1] = (my + vc).toFloat()
    out[2] = sqrt(uc * uc + vc * vc + (suu + svv) / n).toFloat()
    return true
  }

  /**
   * Sharpen one ball centre by fitting a circle to its rim.
   *
   * Rays go out from the centroid we already have until the cloth margin crosses
   * zero, which is the rim. Whatever else is not-cloth and touching — a
   * neighbouring ball, a guideline, the printed cut angle — sends its rays
   * straight past the rim into cloth much further out, so those crossings come
   * back far too long. They are only ever *too long*, never too short, which is
   * what makes them easy to throw away: seed on the tightest cluster of radii,
   * then reject against the fitted circle over passes that tighten each time.
   *
   * Returns false, leaving the centroid alone, when too much of the rim is
   * missing or the fit wants to move the centre further than it has any business
   * moving it.
   */
  private fun refineBallCenter(
    cx: Float,
    cy: Float,
    ballRadius: Float,
    width: Int,
    height: Int,
    config: CaptureConfig,
    out: FloatArray,
  ): Boolean {
    val shape = model ?: return false
    var count = 0
    val from = 0.35f * ballRadius
    val to = 1.75f * ballRadius
    fillMarginBox(cx, cy, to + 1f, width, height, shape)
    for (k in 0 until EDGE_RAYS) {
      val a = (2.0 * PI * k / EDGE_RAYS).toFloat()
      val ux = cos(a)
      val uy = sin(a)
      var prev = Float.NaN
      var prevS = from
      var s = from
      while (s < to) {
        val v = clothMarginAt(cx + s * ux, cy + s * uy)
        if (v.isNaN()) break
        if (!prev.isNaN() && prev < 0f && v >= 0f) {
          // Straddled the rim: place it where the margin would read zero.
          val t = prevS + (s - prevS) * (0f - prev) / (v - prev)
          edgeX[count] = cx + t * ux
          edgeY[count] = cy + t * uy
          edgeR[count] = t
          count++
          break
        }
        prev = v
        prevS = s
        s += EDGE_STEP
      }
    }
    if (count < config.ballEdgeMinPoints) return false

    // Seed on the tightest half of the radii. Contamination only ever pushes a
    // crossing outward, so the close-packed side of the spread is the honest one.
    System.arraycopy(edgeR, 0, edgeSorted, 0, count)
    Arrays.sort(edgeSorted, 0, count)
    val half = count / 2
    var bestAt = 0
    var bestSpan = Float.MAX_VALUE
    for (i in 0..count - half) {
      val span = edgeSorted[i + half - 1] - edgeSorted[i]
      if (span < bestSpan) {
        bestSpan = span
        bestAt = i
      }
    }
    val seed = edgeSorted[bestAt + half / 2]

    var kept = 0
    for (i in 0 until count) {
      edgeKeep[i] = abs(edgeR[i] - seed) < EDGE_TOLERANCES[0]
      if (edgeKeep[i]) kept++
    }
    if (kept < config.ballEdgeMinPoints) return false

    for (tol in EDGE_TOLERANCES) {
      if (!fitCircle(count, out)) return false
      kept = 0
      for (i in 0 until count) {
        val d = abs(hypot(edgeX[i] - out[0], edgeY[i] - out[1]) - out[2])
        edgeKeep[i] = d < tol
        if (edgeKeep[i]) kept++
      }
      if (kept < config.ballEdgeMinPoints) return false
    }
    if (!fitCircle(count, out)) return false

    val shift = hypot(out[0] - cx, out[1] - cy)
    if (shift > config.ballEdgeMaxShiftRadii * ballRadius) return false
    if (out[2] < 0.8f * ballRadius || out[2] > 1.2f * ballRadius) return false
    return true
  }

  private class ContactRing(val x: Float, val y: Float, val radius: Float, val score: Float)

  /**
   * Finds the ghost-ball circle drawn where the cue ball meets the object ball.
   *
   * Worth the cycles because of how the object ball's direction is built. It
   * leaves along the line from the contact point to its own centre, and that
   * line is one ball diameter long, so an error in the contact point is divided
   * by 2R when it becomes an angle: around a ball radius of sixteen pixels, one
   * pixel is close to two degrees. Working the contact out instead of measuring
   * it means extending the aim direction over the whole length of the shot
   * first, which turns a quarter of a degree of aim error into several pixels
   * before the division ever happens. Nothing similar happens to a cushion
   * rebound, whose angle is simply as good as the aim.
   *
   * A circle is also a much better thing to fit than a line. Every pixel of it
   * votes for one centre, so a stray line crossing the window raises a ridge in
   * the accumulator rather than a peak, and the answer carries the whole
   * circumference behind it.
   */
  private fun findContactRing(
    width: Int,
    height: Int,
    px: Float,
    py: Float,
    ballRadius: Float,
    config: CaptureConfig
  ): ContactRing? {
    val span = (ballRadius * config.contactSearchRadii).toInt()
    val x0 = max(px.toInt() - span, 0)
    val x1 = min(px.toInt() + span, width - 1)
    val y0 = max(py.toInt() - span, 0)
    val y1 = min(py.toInt() + span, height - 1)
    if (x1 <= x0 || y1 <= y0) return null

    var lit = 0
    for (y in y0..y1) {
      val base = y * width
      for (x in x0..x1) {
        if (!guide[base + x]) continue
        if (lit >= MAX_RING_PIXELS) break
        ringX[lit] = x.toFloat()
        ringY[lit] = y.toFloat()
        lit++
      }
    }
    if (lit < MIN_RING_PIXELS) return null

    // Half-pixel accumulator over the same window.
    val aw = (x1 - x0) * RING_SUBDIV + 1
    val ah = (y1 - y0) * RING_SUBDIV + 1
    val cells = aw * ah
    if (ringAcc.size < cells) ringAcc = FloatArray(cells)

    var best: ContactRing? = null
    val rMin = ballRadius * config.contactMinRadii.toFloat()
    val rMax = ballRadius * config.contactMaxRadii.toFloat()
    var r = rMin
    while (r <= rMax) {
      java.util.Arrays.fill(ringAcc, 0, cells, 0f)
      // Step the vote circle at about two pixels, so a ring is sampled evenly
      // whatever its radius and a big one is not simply given more votes.
      val steps = max(24, (Math.PI * r).toInt())
      var peak = 0f
      var peakAt = -1
      for (k in 0 until steps) {
        val t = 2.0 * Math.PI * k / steps
        val ox = (r * cos(t)).toFloat()
        val oy = (r * sin(t)).toFloat()
        for (i in 0 until lit) {
          val gx = ((ringX[i] + ox - x0) * RING_SUBDIV).toInt()
          val gy = ((ringY[i] + oy - y0) * RING_SUBDIV).toInt()
          if (gx < 0 || gx >= aw || gy < 0 || gy >= ah) continue
          val at = gy * aw + gx
          val v = ringAcc[at] + 1f
          ringAcc[at] = v
          if (v > peak) {
            peak = v
            peakAt = at
          }
        }
      }
      // The accumulator proposes a centre; coverage decides. A vote count says
      // how much ink landed a radius away, which a thick line crossing the window
      // can fake, whereas walking the circle asks the question that actually
      // matters: how much of *this* circle is drawn? It is also a number with a
      // meaning, so the threshold can be reasoned about rather than tuned.
      if (peakAt >= 0 && peak > 0f) {
        val px0 = peakAt % aw
        val py0 = peakAt / aw
        for (dy in -1..1) {
          for (dx in -1..1) {
            val gx = px0 + dx
            val gy = py0 + dy
            if (gx < 0 || gx >= aw || gy < 0 || gy >= ah) continue
            val ccx = gx.toFloat() / RING_SUBDIV + x0
            val ccy = gy.toFloat() / RING_SUBDIV + y0
            var on = 0
            for (k in 0 until steps) {
              val t = 2.0 * Math.PI * k / steps
              val sx = (ccx + r * cos(t)).toInt()
              val sy = (ccy + r * sin(t)).toInt()
              if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue
              if (guide[sy * width + sx]) on++
            }
            val score = on.toFloat() / steps
            if (score >= config.contactMinScore.toFloat() &&
              (best == null || score > best.score)
            ) {
              best = ContactRing(x = ccx, y = ccy, radius = r, score = score)
            }
          }
        }
      }
      r += 0.5f
    }
    return best
  }

  private fun normalizeAngle(a: Float): Float {
    var x = a
    val twoPi = (2.0 * Math.PI).toFloat()
    while (x > Math.PI) x -= twoPi
    while (x < -Math.PI) x += twoPi
    return x
  }

  // -- Power meter -------------------------------------------------------------

  /**
   * Locate the power meter and its ferrule. Writes slot top, slot bottom and
   * tip y into `out` and returns true, or returns false when there is no meter
   * on screen (it is hidden whenever it is not your shot).
   *
   * Two colour facts carry the whole thing. The slot's interior runs olive to
   * dark red, so red beats blue on every pixel of it, while the app's chrome
   * around it is dark blue — that isolates the widget from everything except
   * the table's cushion, which is also warm but far wider and further right,
   * and is rejected on shape. Inside the slot the ferrule is then the only
   * thing that is bright and colourless at once; the shaft is tan and the
   * track behind it never comes near white.
   */
  private fun findPowerMeter(width: Int, height: Int, config: CaptureConfig, out: FloatArray): Boolean {
    val limit = min(width, max(1, (width * config.powerMaxXFraction).toInt()))
    val minRun = height * 0.25f
    val maxSlotWidth = max(2, (width * config.powerMaxSlotWidthFraction).toInt())
    val minSlotWidth = max(2, (width * config.powerMinSlotWidthFraction).toInt())
    val minSlotHeight = height * config.powerMinSlotHeightFraction

    // Columns that are warm over a good part of their height.
    var x = 0
    while (x < limit) {
      var warm = 0
      var y = 0
      while (y < height) {
        val p = pixels[y * width + x]
        val r = (p shr 16) and 0xFF
        val b = p and 0xFF
        if (r > 35 && b < 30 && r > 2 * b) warm++
        y++
      }
      if (warm < minRun) {
        x++
        continue
      }

      // Extend across the run. The tan shaft fails the warm test, so the run
      // has a gap down its middle; tolerate one about a shaft wide.
      val start = x
      var end = x
      var gap = 0
      var scan = x + 1
      while (scan < limit && gap <= 14) {
        var w2 = 0
        var y2 = 0
        while (y2 < height) {
          val p = pixels[y2 * width + scan]
          val r = (p shr 16) and 0xFF
          val b = p and 0xFF
          if (r > 35 && b < 30 && r > 2 * b) w2++
          y2++
        }
        if (w2 >= minRun) {
          end = scan
          gap = 0
        } else {
          gap++
        }
        scan++
      }

      val span = end - start + 1
      if (span in minSlotWidth..maxSlotWidth) {
        // Vertical extent of the warm band.
        var top = -1
        var bottom = -1
        var y3 = 0
        while (y3 < height) {
          var n = 0
          var k = start
          while (k <= end) {
            val p = pixels[y3 * width + k]
            val r = (p shr 16) and 0xFF
            val b = p and 0xFF
            if (r > 35 && b < 30 && r > 2 * b) n++
            k++
          }
          if (n >= 2) {
            if (top < 0) top = y3
            bottom = y3
          }
          y3++
        }
        if (top >= 0 && bottom - top + 1 >= minSlotHeight) {
          val tip = findFerrule(start, end, top, bottom, width, config)
          out[0] = top.toFloat()
          out[1] = (bottom + 1).toFloat()
          out[2] = tip
          return true
        }
      }
      x = max(scan, start + 1)
    }
    return false
  }

  /**
   * Centroid y of the topmost bright colourless blob in the slot, or NaN. The
   * blob has to be a few pixels wide to count: the shaft carries a one-pixel
   * specular highlight down its length that is otherwise a perfect decoy.
   */
  private fun findFerrule(
    x0: Int, x1: Int, y0: Int, y1: Int, width: Int, config: CaptureConfig,
  ): Float {
    val span = x1 - x0 + 1
    val need = max(2, (span * 0.18f).toInt())
    var start = -1
    var y = y0
    while (y <= y1) {
      var lit = 0
      var k = x0
      while (k <= x1) {
        val p = pixels[y * width + k]
        val r = (p shr 16) and 0xFF
        val g = (p shr 8) and 0xFF
        val b = p and 0xFF
        val mx = max(r, max(g, b))
        val mn = min(r, min(g, b))
        if (mx >= config.powerTipMinValue && mx - mn <= config.powerTipMaxSpread) lit++
        k++
      }
      if (lit >= need) {
        if (start < 0) start = y
      } else if (start >= 0) {
        break
      }
      y++
    }
    if (start < 0 || y - start < 3) return Float.NaN

    var sum = 0f
    var wsum = 0f
    var row = start
    while (row < y) {
      var lit = 0
      var k = x0
      while (k <= x1) {
        val p = pixels[row * width + k]
        val r = (p shr 16) and 0xFF
        val g = (p shr 8) and 0xFF
        val b = p and 0xFF
        val mx = max(r, max(g, b))
        val mn = min(r, min(g, b))
        if (mx >= config.powerTipMinValue && mx - mn <= config.powerTipMaxSpread) lit++
        k++
      }
      sum += row * lit
      wsum += lit
      row++
    }
    return if (wsum <= 0f) Float.NaN else sum / wsum
  }

  private fun elapsedMs(startedNanos: Long) =
    (System.nanoTime() - startedNanos) / 1_000_000

  private companion object {
    /** A rack is sixteen; the slack absorbs a bad frame without reallocating. */
    const val MAX_BALLS = 24

    // -- Cloth learning ------------------------------------------------------

    /**
     * Chroma below which a cloth has no hue to speak of and the direction test
     * is meaningless. The near-black skin measures under 2; the least colourful
     * skin that does have a hue, the teal, measures 32.
     */
    const val NEUTRAL_CHROMA = 12f

    /** Samples aimed for per learning round, and the buffer that holds them. */
    const val LEARN_SAMPLES = 2400
    const val MAX_SAMPLES = 4096

    /** Sample box, mask, rectangle; then again from the rectangle it found. */
    const val LEARN_ROUNDS = 3

    /** Frames skipped after a learning attempt that found no table. */
    const val LEARN_COOLDOWN_FRAMES = 8

    /**
     * Where to start the playfield fill, as percentages of the frame offset
     * from its middle, in the order they are tried.
     *
     * The middle first, then a ring well clear of it, then a wider one. The
     * offsets are deliberately not symmetric about the axes: the guideline and
     * the cue lie along them, so a candidate on the diagonal is far more likely
     * to land on cloth than one directly above or beside the first.
     */
    val SEED_OFFSETS = intArrayOf(
      0, 0,
      -12, -14, 12, -14, -12, 14, 12, 14,
      -24, -8, 24, -8, -24, 8, 24, 8,
      -32, -20, 32, -20, -32, 20, 32, 20
    )

    /** Fills attempted before the frame is written off as having no table. */
    const val MAX_SEED_ATTEMPTS = 7

    /**
     * Where the guideline's brightness floor sits relative to the cloth's own.
     *
     * The line is white drawn through the felt, so it comes out at least as
     * bright as the felt it crosses — a shade under the cloth's median peak
     * channel is the floor that follows from that. Lower than this and the
     * detector starts finding lines in the moving balls after a shot has been
     * played, which keeps stale trajectories on screen; on the reference table
     * it lands at 172, where the fixed threshold it replaced was 200.
     */
    const val GUIDE_VALUE_OF_CLOTH = 0.92f

    /**
     * Floors tried for the playfield mask, as multiples of the third percentile
     * of the cloth's own saturation.
     *
     * The spread is what the search is for. On most skins the loosest of these
     * is right and the cushion nose stops the mask on its own; on the brown one
     * the rail answers the same colour test and only a floor two and a half
     * times higher stops at the cushion. Nothing in the sample says which case
     * a given table is, but the rectangle each produces says it plainly.
     */
    val RECT_FLOORS = floatArrayOf(0.45f, 0.62f, 0.80f, 1.00f, 1.25f)

    /**
     * Floor used for the ball mask, always the loosest. Every pixel of real
     * cloth that fails here becomes not-cloth, and enough of them along a
     * cushion merge into a region too large to be a ball, taking any ball
     * resting there with it.
     */
    const val BALL_FLOOR = 0.45f

    /** The playfield measures 1514 x 786 on the reference frames. */
    const val TARGET_ASPECT = 1.9276f
    const val ASPECT_SLACK = 0.075f

    /** Outside this a rectangle is not a table, and the colour is suspect. */
    const val MIN_TABLE_ASPECT = 1.55f
    const val MAX_TABLE_ASPECT = 2.35f

    /**
     * Candidates held before suppression runs. Comfortably more than MAX_BALLS,
     * because a ball can raise two plateaus and the deeper of the pair has to
     * still be in the list when they are compared.
     */
    const val MAX_PEAKS = 96

    /**
     * Lit pixels the contact search will look at, and the fewest it needs.
     * A ring of radius R contributes roughly 2*PI*R*stroke of them, so a
     * sixteen-pixel circle drawn four wide is around four hundred on its own;
     * the cap is there for the case where the window lands on the HUD.
     */
    const val MAX_RING_PIXELS = 4096
    const val MIN_RING_PIXELS = 60
    /** Accumulator cells per pixel. Half-pixel centres are finer than the
     *  measurement deserves and cost little at this window size. */
    const val RING_SUBDIV = 2

    /** Rays cast outward from a ball centre looking for its rim. */
    const val EDGE_RAYS = 128
    /** Step along each ray, in pixels. Finer than this buys nothing: the
     *  crossing is interpolated from the two samples that straddle it. */
    const val EDGE_STEP = 0.25f
    /** Tolerances for successive rejection passes, in pixels. */
    val EDGE_TOLERANCES = floatArrayOf(2.0f, 1.5f, 1.0f, 0.8f)
  }
}
