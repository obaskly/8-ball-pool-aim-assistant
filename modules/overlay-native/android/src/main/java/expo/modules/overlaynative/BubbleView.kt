package expo.modules.overlaynative

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs
import kotlin.math.min

/**
 * The floating chip that opens the control panel without leaving the game.
 *
 * It lives in its own small window rather than inside the trajectory overlay,
 * because those two want opposite things from the window manager: the overlay
 * is pass-through so the game underneath keeps receiving every touch, and this
 * has to catch touches to be draggable and tappable at all. One window cannot
 * be both, so there are two.
 *
 * Everything is drawn in code, except the app's own launcher icon: that is
 * fetched once from PackageManager at construction time rather than shipped
 * as a second copy through the module's own res/ folder, which would have to
 * survive resource merging just to duplicate an asset the host app already has.
 */
@SuppressLint("ViewConstructor")
class BubbleView(context: Context) : View(context) {

  /** Called on a tap that was not a drag. */
  var onTap: (() -> Unit)? = null

  /** (dx, dy) in pixels since the last move, for the service to reposition us. */
  var onDrag: ((Int, Int) -> Unit)? = null

  /**
   * Whether the overlay currently has a reading to draw. Purely informational,
   * but it is the only feedback available while the game is in front: a green
   * ring means the table is being read, amber means it is coasting or lost.
   */
  var active: Boolean = false
    set(value) {
      if (field == value) return
      field = value
      postInvalidateOnAnimation()
    }

  private val density = context.resources.displayMetrics.density

  private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
    color = COLOR_BODY
  }

  private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = 2f * density
  }

  private val glyphPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
    color = Color.WHITE
    textAlign = Paint.Align.CENTER
    isFakeBoldText = true
  }

  // Loaded once and reused; the app's icon never changes at runtime.
  private val iconBitmap: Bitmap? = try {
    val drawable = context.packageManager.getApplicationIcon(context.packageName)
    val size = (SIZE_DP * context.resources.displayMetrics.density * 0.5f).toInt().coerceAtLeast(1)
    Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).also { bmp ->
      drawable.setBounds(0, 0, size, size)
      drawable.draw(Canvas(bmp))
    }
  } catch (e: Exception) {
    null
  }

  // Scratch objects reused every onDraw so drawing the icon allocates nothing.
  private val iconClipPath = Path()
  private val iconDstRect = RectF()

  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

  private var downRawX = 0f
  private var downRawY = 0f
  private var lastRawX = 0f
  private var lastRawY = 0f
  private var dragging = false

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val size = (SIZE_DP * density).toInt()
    setMeasuredDimension(size, size)
  }

  override fun onDraw(canvas: Canvas) {
    val cx = width / 2f
    val cy = height / 2f
    val outer = min(cx, cy) - ringPaint.strokeWidth

    canvas.drawCircle(cx, cy, outer, bodyPaint)

    ringPaint.color = if (active) COLOR_ACTIVE else COLOR_IDLE
    canvas.drawCircle(cx, cy, outer, ringPaint)

    // The app icon inset in a white disc, which reads at this size against
    // both the dark body and whatever is behind the chip.
    val discRadius = outer * 0.46f
    glyphPaint.color = Color.WHITE
    canvas.drawCircle(cx, cy, discRadius, glyphPaint)

    val bmp = iconBitmap
    if (bmp != null) {
      // Clip to a circle strictly inside the disc so the icon's own square
      // corners (or an OEM adaptive-icon mask shaped differently from ours)
      // never poke past the white edge.
      val iconRadius = discRadius * 0.86f
      iconClipPath.reset()
      iconClipPath.addCircle(cx, cy, iconRadius, Path.Direction.CW)
      canvas.save()
      canvas.clipPath(iconClipPath)
      iconDstRect.set(cx - iconRadius, cy - iconRadius, cx + iconRadius, cy + iconRadius)
      canvas.drawBitmap(bmp, null, iconDstRect, null)
      canvas.restore()
    } else {
      // Fallback for the near-impossible case the icon couldn't be loaded.
      glyphPaint.color = COLOR_BODY
      glyphPaint.textSize = discRadius * 1.5f
      // drawText places the baseline; centre the glyph box on the disc instead.
      val metrics = glyphPaint.fontMetrics
      canvas.drawText("8", cx, cy - (metrics.ascent + metrics.descent) / 2f, glyphPaint)
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downRawX = event.rawX
        downRawY = event.rawY
        lastRawX = event.rawX
        lastRawY = event.rawY
        dragging = false
        alpha = PRESSED_ALPHA
        return true
      }

      MotionEvent.ACTION_MOVE -> {
        // Report deltas rather than absolute positions: the window's own
        // coordinates are what move, and the pointer stays put relative to the
        // chip, so anything absolute makes it jump on the first move event.
        val dx = event.rawX - lastRawX
        val dy = event.rawY - lastRawY
        lastRawX = event.rawX
        lastRawY = event.rawY

        if (!dragging &&
          (abs(event.rawX - downRawX) > touchSlop || abs(event.rawY - downRawY) > touchSlop)
        ) {
          dragging = true
        }
        if (dragging) onDrag?.invoke(dx.toInt(), dy.toInt())
        return true
      }

      MotionEvent.ACTION_UP -> {
        alpha = RESTING_ALPHA
        if (!dragging) onTap?.invoke()
        return true
      }

      MotionEvent.ACTION_CANCEL -> {
        alpha = RESTING_ALPHA
        return true
      }
    }
    return false
  }

  init {
    alpha = RESTING_ALPHA
    setWillNotDraw(false)
  }

  companion object {
    const val SIZE_DP = 52f

    private const val COLOR_BODY = 0xFF15202B.toInt()
    private const val COLOR_ACTIVE = 0xFF3DDC84.toInt()
    private const val COLOR_IDLE = 0xFFF2A33C.toInt()

    /** Slightly transparent at rest so it never fully hides a ball underneath. */
    private const val RESTING_ALPHA = 0.82f
    private const val PRESSED_ALPHA = 1f
  }
}
