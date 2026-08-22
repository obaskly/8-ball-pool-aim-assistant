package expo.modules.overlaynative

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.View

/**
 * Transparent draw surface for the overlay window.
 *
 * The view never holds a scene of its own: it reads the current snapshot from
 * [OverlayController] inside onDraw. Scene updates therefore cost one atomic
 * reference swap plus a redraw request, with no cross-thread copying.
 *
 * Paints and the reusable [Path] are allocated once. onDraw only mutates them.
 */
@SuppressLint("ViewConstructor")
class OverlayCanvasView(context: Context) : View(context) {

  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }

  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
  }

  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.FILL
    textAlign = Paint.Align.LEFT
  }

  private val path = Path()

  /** Set by the service; when false the view never sees touch events at all. */
  var interactive: Boolean = false

  init {
    // Nothing is drawn behind the trajectories, so no background layer is needed.
    // The window is already hardware accelerated; forcing an explicit layer here
    // would only allocate a full-screen offscreen buffer for no gain.
    setWillNotDraw(false)
  }

  override fun onDraw(canvas: Canvas) {
    val scene = OverlayController.scene

    for (line in scene.polylines) {
      val pts = line.points
      path.rewind()
      path.moveTo(pts[0], pts[1])
      var i = 2
      while (i + 1 < pts.size) {
        path.lineTo(pts[i], pts[i + 1])
        i += 2
      }
      strokePaint.color = line.color
      strokePaint.strokeWidth = line.width
      strokePaint.pathEffect = line.dash
      canvas.drawPath(path, strokePaint)
    }
    strokePaint.pathEffect = null

    for (c in scene.circles) {
      if (c.filled) {
        fillPaint.color = c.color
        canvas.drawCircle(c.x, c.y, c.radius, fillPaint)
      } else {
        strokePaint.color = c.color
        strokePaint.strokeWidth = c.width
        canvas.drawCircle(c.x, c.y, c.radius, strokePaint)
      }
    }

    for (l in scene.labels) {
      textPaint.color = l.color
      textPaint.textSize = l.size
      canvas.drawText(l.text, l.x, l.y, textPaint)
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!interactive) return false

    val phase = when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> "down"
      MotionEvent.ACTION_MOVE -> "move"
      MotionEvent.ACTION_UP -> "up"
      MotionEvent.ACTION_CANCEL -> "cancel"
      else -> return false
    }

    OverlayController.dispatchTouch(phase, event.rawX, event.rawY)
    return true
  }
}
