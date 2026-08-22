package expo.modules.overlaynative

import android.graphics.Color
import android.graphics.DashPathEffect
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.atomic.AtomicReference

// ---------------------------------------------------------------------------
// Payload records: what JavaScript sends across the bridge.
// ---------------------------------------------------------------------------

class PolylineRecord : Record {
  /** Flattened [x0, y0, x1, y1, ...] in physical screen pixels. */
  @Field var points: List<Double> = emptyList()
  @Field var color: String = "#FFFFFFFF"
  @Field var width: Double = 3.0
  /** Dash length in pixels. 0 draws a solid line. */
  @Field var dash: Double = 0.0
  @Field var alpha: Double = 1.0
}

class CircleRecord : Record {
  @Field var x: Double = 0.0
  @Field var y: Double = 0.0
  @Field var radius: Double = 0.0
  @Field var color: String = "#FFFFFFFF"
  @Field var width: Double = 2.0
  @Field var filled: Boolean = false
  @Field var alpha: Double = 1.0
}

class LabelRecord : Record {
  @Field var x: Double = 0.0
  @Field var y: Double = 0.0
  @Field var text: String = ""
  @Field var color: String = "#FFFFFFFF"
  @Field var size: Double = 28.0
  @Field var alpha: Double = 1.0
}

class SceneRecord : Record {
  @Field var polylines: List<PolylineRecord> = emptyList()
  @Field var circles: List<CircleRecord> = emptyList()
  @Field var labels: List<LabelRecord> = emptyList()
}

// ---------------------------------------------------------------------------
// Draw-ready scene. Records are converted once on push so that onDraw stays
// allocation-free on the render path.
// ---------------------------------------------------------------------------

class DrawPolyline(
  val points: FloatArray,
  val color: Int,
  val width: Float,
  val dash: DashPathEffect?
)

class DrawCircle(
  val x: Float,
  val y: Float,
  val radius: Float,
  val color: Int,
  val width: Float,
  val filled: Boolean
)

class DrawLabel(
  val x: Float,
  val y: Float,
  val text: String,
  val color: Int,
  val size: Float
)

class DrawScene(
  val polylines: List<DrawPolyline>,
  val circles: List<DrawCircle>,
  val labels: List<DrawLabel>
) {
  companion object {
    val EMPTY = DrawScene(emptyList(), emptyList(), emptyList())
  }
}

private fun parseColor(value: String, alpha: Double): Int {
  val base = try {
    Color.parseColor(value)
  } catch (_: IllegalArgumentException) {
    Color.WHITE
  }
  val a = (Color.alpha(base) * alpha.coerceIn(0.0, 1.0)).toInt().coerceIn(0, 255)
  return Color.argb(a, Color.red(base), Color.green(base), Color.blue(base))
}

fun SceneRecord.toDrawScene(): DrawScene {
  val lines = polylines.mapNotNull { p ->
    // Need at least two points to draw anything.
    if (p.points.size < 4) return@mapNotNull null
    val pts = FloatArray(p.points.size) { p.points[it].toFloat() }
    val width = p.width.toFloat().coerceAtLeast(0.5f)
    val dash = if (p.dash > 0.0) {
      val d = p.dash.toFloat()
      DashPathEffect(floatArrayOf(d, d), 0f)
    } else {
      null
    }
    DrawPolyline(pts, parseColor(p.color, p.alpha), width, dash)
  }

  val circs = circles.map { c ->
    DrawCircle(
      c.x.toFloat(),
      c.y.toFloat(),
      c.radius.toFloat(),
      parseColor(c.color, c.alpha),
      c.width.toFloat().coerceAtLeast(0.5f),
      c.filled
    )
  }

  val labs = labels.map { l ->
    DrawLabel(l.x.toFloat(), l.y.toFloat(), l.text, parseColor(l.color, l.alpha), l.size.toFloat())
  }

  return DrawScene(lines, circs, labs)
}

// ---------------------------------------------------------------------------
// Coordination between the Expo module, the service and the view.
// ---------------------------------------------------------------------------

/** Implemented by the service that owns the overlay window. */
interface OverlayHost {
  fun requestRedraw()
  fun setInteractive(interactive: Boolean)
  fun setBubbleVisible(visible: Boolean)
}

/**
 * Single coordination point. The module writes scenes here and the service's view
 * reads them, so scene updates never travel through an Intent.
 */
object OverlayController {
  private val sceneRef = AtomicReference(DrawScene.EMPTY)
  val scene: DrawScene get() = sceneRef.get()

  @Volatile
  private var host: OverlayHost? = null

  @Volatile
  var isRunning: Boolean = false
    private set

  /** (phase, x, y) in physical screen pixels. */
  var onTouch: ((String, Float, Float) -> Unit)? = null
  var onStateChange: ((Boolean) -> Unit)? = null
  var onBubbleTap: (() -> Unit)? = null

  /**
   * Survives the service, so the chip comes back where the user left it after a
   * stop and start rather than jumping to its default corner.
   *
   * Assigning applies it to a live overlay; when none is attached the value is
   * simply remembered until the next one starts.
   */
  @Volatile
  var bubbleVisible: Boolean = true
    set(value) {
      field = value
      host?.setBubbleVisible(value)
    }

  /** Last dragged position, or -1 for "wherever the service puts it by default". */
  @Volatile
  var bubbleX: Int = -1

  @Volatile
  var bubbleY: Int = -1

  fun attach(newHost: OverlayHost) {
    host = newHost
    isRunning = true
    onStateChange?.invoke(true)
  }

  fun detach() {
    host = null
    isRunning = false
    sceneRef.set(DrawScene.EMPTY)
    onStateChange?.invoke(false)
  }

  fun push(next: DrawScene) {
    sceneRef.set(next)
    host?.requestRedraw()
  }

  fun setInteractive(interactive: Boolean) {
    host?.setInteractive(interactive)
  }

  fun dispatchTouch(phase: String, x: Float, y: Float) {
    onTouch?.invoke(phase, x, y)
  }

  fun dispatchBubbleTap() {
    onBubbleTap?.invoke()
  }
}
