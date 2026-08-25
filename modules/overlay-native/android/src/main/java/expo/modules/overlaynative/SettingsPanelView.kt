package expo.modules.overlaynative

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The control panel, as a window that sits on top of the game.
 *
 * This exists because the panel it replaces was a separate activity: tapping the
 * floating chip switched away from the game to reach it, and getting back meant
 * switching again. Android tears the capture session down on that round trip
 * often enough that changing one setting could cost a re-consent dialog and a
 * fresh read of the table. Everything here is reachable without the game ever
 * losing the foreground.
 *
 * The full panel in the app is still the complete one, and there is a button to
 * open it. What lives here is the subset worth changing between shots.
 *
 * Built in code rather than from a layout resource for the same reason
 * [BubbleView] is: a local Expo module's `res/` folder does not survive resource
 * merging into the host app, so anything inflated from XML would go missing in a
 * release build.
 */
@SuppressLint("ViewConstructor")
class SettingsPanelView(context: Context) : LinearLayout(context) {

  /** A control changed. (key, value) goes straight to JS, which owns the state. */
  var onChange: ((String, Any) -> Unit)? = null

  /** The header was dragged. (dx, dy) in pixels since the last move. */
  var onDrag: ((Int, Int) -> Unit)? = null

  /** Minimise was tapped. The chip stays; this window goes away. */
  var onMinimize: (() -> Unit)? = null

  private val density = context.resources.displayMetrics.density

  private val statusValue: TextView
  private val detailValue: TextView
  private val clothValue: TextView
  private val powerLabel: TextView
  private val powerBar: SeekBar
  private val depthLabel: TextView
  private val depthBar: SeekBar
  private val cushionLabel: TextView
  private val cushionBar: SeekBar
  private val powerSource: Segmented
  private val spin: Segmented
  private val toggles = HashMap<String, Toggle>()

  /**
   * True while a value is being written in from JS, so the listeners that fire
   * as a side effect of that do not echo it straight back. Without it, dragging
   * a slider fights the state coming back the other way and the thumb jumps.
   */
  private var applying = false

  /** Height the panel may grow to before its body starts scrolling. */
  var maxHeight: Int = 0
    set(value) {
      field = value
      requestLayout()
    }

  override fun onMeasure(widthSpec: Int, heightSpec: Int) {
    val cap = maxHeight
    if (cap <= 0) {
      super.onMeasure(widthSpec, heightSpec)
      return
    }
    super.onMeasure(
      widthSpec,
      MeasureSpec.makeMeasureSpec(cap, MeasureSpec.AT_MOST)
    )
  }

  private fun dp(value: Float) = (value * density).roundToInt()

  init {
    orientation = VERTICAL
    background = GradientDrawable().apply {
      cornerRadius = dp(14f).toFloat()
      setColor(COLOR_PANEL)
      setStroke(dp(1f), COLOR_BORDER)
    }
    elevation = dp(8f).toFloat()

    addView(header())

    val scroll = ScrollView(context).apply {
      isFillViewport = false
      overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
    }
    val body = LinearLayout(context).apply {
      orientation = VERTICAL
      setPadding(dp(14f), dp(4f), dp(14f), dp(14f))
    }

    statusValue = stat(body, "Reading", "—")
    detailValue = stat(body, "Rate", "—")
    clothValue = stat(body, "Table colour", "—")

    body.addView(gap(10f))
    body.addView(
      row(
        button("Re-read colour") { onChange?.invoke(KEY_RELEARN, true) },
        button("Stop reading") { onChange?.invoke(KEY_STOP, true) }
      )
    )
    body.addView(gap(4f))
    body.addView(
      row(button("Open the full panel") { onChange?.invoke(KEY_OPEN_APP, true) })
    )

    body.addView(divider())
    body.addView(label("Power"))
    powerSource = Segmented(
      context,
      listOf("Read meter" to "auto", "Slider" to "manual")
    ) { value -> emit(KEY_POWER_SOURCE, value) }
    body.addView(powerSource)
    powerLabel = label("Slider power  85%")
    body.addView(powerLabel)
    powerBar = slider(0, 95) { v ->
      val power = 0.05f + v / 100f
      powerLabel.text = "Slider power  ${(power * 100).roundToInt()}%"
      emit(KEY_POWER, power.toDouble())
    }
    body.addView(powerBar)

    body.addView(divider())
    body.addView(label("Cue ball after contact"))
    spin = Segmented(
      context,
      listOf("Auto" to "auto", "Stun" to "stun", "Roll" to "natural")
    ) { value -> emit(KEY_SPIN, value) }
    body.addView(spin)

    depthLabel = label("Collision depth  2")
    body.addView(depthLabel)
    depthBar = slider(0, 4) { v ->
      depthLabel.text = "Collision depth  $v"
      emit(KEY_DEPTH, v.toDouble())
    }
    body.addView(depthBar)

    cushionLabel = label("Cushions per path  3")
    body.addView(cushionLabel)
    cushionBar = slider(0, 8) { v ->
      cushionLabel.text = "Cushions per path  $v"
      emit(KEY_CUSHIONS, v.toDouble())
    }
    body.addView(cushionBar)

    body.addView(divider())
    addToggle(body, KEY_SHOW_TABLE, "Table outline")
    addToggle(body, KEY_SHOW_BALLS, "Ball positions")
    addToggle(body, KEY_SHOW_CUT, "Cut angle")

    scroll.addView(
      body,
      ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      )
    )
    addView(
      scroll,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT)
    )
  }

  /**
   * Pushes the current state in. Every field is authoritative; JS owns them.
   *
   * Not called `apply`: that would sit next to Kotlin's own `apply` on every
   * view in this file and read as the same thing.
   */
  fun render(state: Map<String, Any?>) {
    applying = true
    try {
      statusValue.text = state["status"] as? String ?: "—"
      detailValue.text = state["detail"] as? String ?: "—"
      clothValue.text = state["clothColor"] as? String ?: "—"

      powerSource.select(state["powerSource"] as? String ?: "auto")
      spin.select(state["cueBallSpin"] as? String ?: "auto")

      val power = (state["power"] as? Number)?.toFloat() ?: 0.85f
      powerBar.progress = ((power - 0.05f) * 100).roundToInt().coerceIn(0, 95)
      powerLabel.text = "Slider power  ${(power * 100).roundToInt()}%"

      val depth = (state["maxDepth"] as? Number)?.toInt() ?: 2
      depthBar.progress = depth.coerceIn(0, 4)
      depthLabel.text = "Collision depth  $depth"

      val cushions = (state["maxCushions"] as? Number)?.toInt() ?: 3
      cushionBar.progress = cushions.coerceIn(0, 8)
      cushionLabel.text = "Cushions per path  $cushions"

      for ((key, toggle) in toggles) toggle.setOn(state[key] == true)
    } finally {
      applying = false
    }
  }

  private fun emit(key: String, value: Any) {
    if (applying) return
    onChange?.invoke(key, value)
  }

  // -- Pieces -----------------------------------------------------------------

  private fun header(): View {
    val bar = LinearLayout(context).apply {
      orientation = HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(14f), dp(10f), dp(8f), dp(6f))
    }
    val title = TextView(context).apply {
      text = "Aim Assistant"
      setTextColor(COLOR_TEXT)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      layoutParams = LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f)
    }
    val minimize = TextView(context).apply {
      text = "Minimise"
      setTextColor(COLOR_ACCENT)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      setPadding(dp(10f), dp(6f), dp(10f), dp(6f))
      setOnClickListener { onMinimize?.invoke() }
    }
    bar.addView(title)
    bar.addView(minimize)
    // Dragging anywhere else on the bar moves the window. Deltas rather than
    // absolute positions: the window moves under the finger, so anything
    // absolute makes it jump on the first move event.
    bar.setOnTouchListener(DragListener())
    return bar
  }

  private inner class DragListener : OnTouchListener {
    private var lastX = 0f
    private var lastY = 0f
    private var downX = 0f
    private var downY = 0f
    private var dragging = false
    private val slop = ViewConfiguration.get(context).scaledTouchSlop

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouch(v: View, event: MotionEvent): Boolean {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          downY = event.rawY
          lastX = event.rawX
          lastY = event.rawY
          dragging = false
          return true
        }

        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - lastX
          val dy = event.rawY - lastY
          lastX = event.rawX
          lastY = event.rawY
          if (!dragging &&
            (abs(event.rawX - downX) > slop || abs(event.rawY - downY) > slop)
          ) {
            dragging = true
          }
          if (dragging) onDrag?.invoke(dx.roundToInt(), dy.roundToInt())
          return true
        }
      }
      return false
    }
  }

  private fun stat(parent: LinearLayout, name: String, initial: String): TextView {
    val line = LinearLayout(context).apply {
      orientation = HORIZONTAL
      setPadding(0, dp(3f), 0, dp(3f))
    }
    line.addView(
      TextView(context).apply {
        text = name
        setTextColor(COLOR_MUTED)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        layoutParams = LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f)
      }
    )
    val value = TextView(context).apply {
      text = initial
      setTextColor(COLOR_TEXT)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
    }
    line.addView(value)
    parent.addView(line)
    return value
  }

  private fun label(text: String) = TextView(context).apply {
    this.text = text
    setTextColor(COLOR_MUTED)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
    setPadding(0, dp(8f), 0, dp(2f))
  }

  private fun gap(height: Float) = View(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, dp(height))
  }

  private fun divider() = View(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, dp(1f)).apply {
      topMargin = dp(12f)
    }
    setBackgroundColor(COLOR_BORDER)
  }

  private fun row(vararg children: View) = LinearLayout(context).apply {
    orientation = HORIZONTAL
    for ((i, child) in children.withIndex()) {
      addView(
        child,
        LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply {
          if (i > 0) leftMargin = dp(8f)
        }
      )
    }
  }

  private fun button(text: String, onTap: () -> Unit) = TextView(context).apply {
    this.text = text
    setTextColor(COLOR_TEXT)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
    gravity = Gravity.CENTER
    setPadding(dp(10f), dp(9f), dp(10f), dp(9f))
    background = GradientDrawable().apply {
      cornerRadius = dp(8f).toFloat()
      setColor(COLOR_BUTTON)
      setStroke(dp(1f), COLOR_BORDER)
    }
    isClickable = true
    setOnClickListener { onTap() }
  }

  private fun slider(min: Int, max: Int, onValue: (Int) -> Unit) =
    SeekBar(context).apply {
      this.max = max - min
      progressDrawable?.setTint(COLOR_ACCENT)
      thumb?.setTint(COLOR_ACCENT)
      setPadding(dp(2f), dp(4f), dp(2f), dp(4f))
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
          if (fromUser) onValue(value + min)
        }

        override fun onStartTrackingTouch(bar: SeekBar) {}
        override fun onStopTrackingTouch(bar: SeekBar) {}
      })
    }

  private fun addToggle(parent: LinearLayout, key: String, text: String) {
    val toggle = Toggle(context, text) { on -> emit(key, on) }
    toggles[key] = toggle
    parent.addView(toggle)
  }

  /**
   * A row that reads as a switch without needing one.
   *
   * `Switch` picks its colours from the host app's theme, and the host here is a
   * React Native activity whose theme is not this panel's, so it comes out
   * invisible on the dark card about as often as not.
   */
  private class Toggle(
    context: Context,
    text: String,
    private val onToggle: (Boolean) -> Unit
  ) : LinearLayout(context) {
    private val density = context.resources.displayMetrics.density
    private val mark: TextView
    private var on = false

    init {
      orientation = HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      val pad = (8 * density).roundToInt()
      setPadding(0, pad, 0, pad)
      isClickable = true

      mark = TextView(context).apply {
        setTextColor(COLOR_ON_ACCENT)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        gravity = Gravity.CENTER
        val w = (30 * density).roundToInt()
        val h = (20 * density).roundToInt()
        layoutParams = LayoutParams(w, h)
      }
      addView(mark)
      addView(
        TextView(context).apply {
          this.text = text
          setTextColor(COLOR_TEXT)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
          layoutParams = LayoutParams(
            LayoutParams.WRAP_CONTENT,
            LayoutParams.WRAP_CONTENT
          ).apply { leftMargin = (10 * density).roundToInt() }
        }
      )
      setOnClickListener {
        setOn(!on)
        onToggle(on)
      }
      setOn(false)
    }

    fun setOn(next: Boolean) {
      on = next
      mark.text = if (next) "ON" else "OFF"
      mark.background = GradientDrawable().apply {
        cornerRadius = 10 * density
        setColor(if (next) COLOR_ACCENT else COLOR_BUTTON)
        setStroke((1 * density).roundToInt(), COLOR_BORDER)
      }
      mark.setTextColor(if (next) COLOR_ON_ACCENT else COLOR_MUTED)
    }
  }

  /** A row of mutually exclusive choices, each carrying the value it stands for. */
  private class Segmented(
    context: Context,
    private val options: List<Pair<String, String>>,
    private val onPick: (String) -> Unit
  ) : LinearLayout(context) {
    private val density = context.resources.displayMetrics.density
    private val cells = ArrayList<TextView>()
    private var selected = options.firstOrNull()?.second

    init {
      orientation = HORIZONTAL
      for ((index, option) in options.withIndex()) {
        val cell = TextView(context).apply {
          text = option.first
          gravity = Gravity.CENTER
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
          val pad = (8 * density).roundToInt()
          setPadding(pad, pad, pad, pad)
          isClickable = true
          setOnClickListener {
            if (selected == option.second) return@setOnClickListener
            select(option.second)
            onPick(option.second)
          }
        }
        cells.add(cell)
        addView(
          cell,
          LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply {
            if (index > 0) leftMargin = (6 * density).roundToInt()
          }
        )
      }
      paint()
    }

    fun select(value: String) {
      if (selected == value) return
      selected = value
      paint()
    }

    private fun paint() {
      for ((index, cell) in cells.withIndex()) {
        val active = options[index].second == selected
        cell.background = GradientDrawable().apply {
          cornerRadius = 8 * density
          setColor(if (active) COLOR_ACCENT else COLOR_BUTTON)
          setStroke((1 * density).roundToInt(), COLOR_BORDER)
        }
        cell.setTextColor(if (active) COLOR_ON_ACCENT else COLOR_TEXT)
      }
    }
  }

  companion object {
    const val WIDTH_DP = 300

    /** Fraction of the screen height the panel may grow to before it scrolls. */
    const val MAX_HEIGHT_FRACTION = 0.86f

    // The control panel's own palette, so the two look like one app.
    private val COLOR_PANEL = Color.parseColor("#F21B2C40")
    private val COLOR_BORDER = Color.parseColor("#FF27496D")
    private val COLOR_BUTTON = Color.parseColor("#FF1B3450")
    private val COLOR_TEXT = Color.parseColor("#FFE8F1F8")
    private val COLOR_MUTED = Color.parseColor("#FF8FA8BF")
    private val COLOR_ACCENT = Color.parseColor("#FF4FC3F7")
    private val COLOR_ON_ACCENT = Color.parseColor("#FF04202F")

    const val KEY_POWER_SOURCE = "powerSource"
    const val KEY_POWER = "power"
    const val KEY_SPIN = "cueBallSpin"
    const val KEY_DEPTH = "maxDepth"
    const val KEY_CUSHIONS = "maxCushions"
    const val KEY_SHOW_TABLE = "showTable"
    const val KEY_SHOW_BALLS = "showBalls"
    const val KEY_SHOW_CUT = "showCutAngle"
    const val KEY_RELEARN = "relearnCloth"
    const val KEY_STOP = "stopCapture"
    const val KEY_OPEN_APP = "openApp"
  }
}
