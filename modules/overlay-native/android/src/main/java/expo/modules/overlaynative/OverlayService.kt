package expo.modules.overlaynative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.drawable.Icon
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.WindowManager

/**
 * Owns the system overlay window.
 *
 * A foreground service is required: a bare service holding a
 * TYPE_APPLICATION_OVERLAY window is killed as soon as the app leaves the
 * foreground, which is exactly when the overlay is meant to be useful.
 *
 * The declared type is `specialUse` (see the module manifest) because this
 * service only draws. Screen capture lives in [CaptureService], which carries the
 * `mediaProjection` type.
 */
class OverlayService : Service(), OverlayHost {

  private var windowManager: WindowManager? = null
  private var view: OverlayCanvasView? = null
  private var layoutParams: WindowManager.LayoutParams? = null
  private var interactive = false

  private var bubble: BubbleView? = null
  private var bubbleParams: WindowManager.LayoutParams? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    startForegroundCompat()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }

    if (!canDrawOverlays()) {
      Log.w(TAG, "Overlay permission is not granted; stopping.")
      stopSelf()
      return START_NOT_STICKY
    }

    interactive = intent?.getBooleanExtra(EXTRA_INTERACTIVE, false) ?: false

    if (view == null) {
      attachOverlay()
    } else {
      setInteractive(interactive)
    }

    // Assigning re-applies it through the controller, which now has a host, so
    // this both honours the extra and restores the remembered state on restart.
    OverlayController.bubbleVisible =
      intent?.getBooleanExtra(EXTRA_BUBBLE, OverlayController.bubbleVisible)
        ?: OverlayController.bubbleVisible

    // Do not resurrect without the JS layer: a restarted service would show a
    // stale, empty overlay the user cannot control.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    OverlayController.detach()
    detachBubble()
    view?.let { v ->
      runCatching { windowManager?.removeView(v) }
        .onFailure { Log.w(TAG, "Failed to remove overlay view", it) }
    }
    view = null
    layoutParams = null
    windowManager = null

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  // -- OverlayHost ----------------------------------------------------------

  override fun requestRedraw() {
    // Safe from any thread and coalesces with the choreographer, so a burst of
    // scene pushes still costs at most one frame.
    view?.postInvalidateOnAnimation()
    // Cheap: BubbleView only repaints when the flag actually flips.
    bubble?.active = OverlayController.scene.polylines.isNotEmpty()
  }

  override fun setInteractive(next: Boolean) {
    interactive = next
    val v = view ?: return
    val params = layoutParams ?: return

    v.interactive = next
    params.flags = windowFlags(next)
    runCatching { windowManager?.updateViewLayout(v, params) }
      .onFailure { Log.w(TAG, "Failed to update overlay layout", it) }
  }

  // -- Window ---------------------------------------------------------------

  private fun attachOverlay() {
    val wm = windowManager ?: return
    val canvas = OverlayCanvasView(this).also { it.interactive = interactive }

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      overlayWindowType(),
      windowFlags(interactive),
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = 0
      y = 0
      // Draw into the cutout and behind the system bars so overlay coordinates
      // match the raw screen coordinates the physics engine works in.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }

    try {
      wm.addView(canvas, params)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to add overlay view", e)
      stopSelf()
      return
    }

    view = canvas
    layoutParams = params
    OverlayController.attach(this)
  }

  // -- Floating chip ---------------------------------------------------------

  override fun setBubbleVisible(visible: Boolean) {
    if (visible) attachBubble() else detachBubble()
  }

  /**
   * A second, small, touchable window.
   *
   * It cannot share the trajectory overlay's window: that one carries
   * FLAG_NOT_TOUCHABLE so the game underneath keeps receiving every touch, and
   * a window with that flag never sees a down event at all.
   */
  private fun attachBubble() {
    if (bubble != null) return
    val wm = windowManager ?: return

    val chip = BubbleView(this)
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      overlayWindowType(),
      // Focusable would steal the IME and the back button from the game.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
        WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = OverlayController.bubbleX.takeIf { it >= 0 } ?: defaultBubbleX()
      y = OverlayController.bubbleY.takeIf { it >= 0 } ?: defaultBubbleY()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }

    chip.onDrag = { dx, dy -> moveBubble(dx, dy) }
    chip.onTap = { openControlPanel() }
    chip.active = OverlayController.scene.polylines.isNotEmpty()

    try {
      wm.addView(chip, params)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to add bubble view", e)
      return
    }

    bubble = chip
    bubbleParams = params
  }

  private fun detachBubble() {
    bubble?.let { b ->
      runCatching { windowManager?.removeView(b) }
        .onFailure { Log.w(TAG, "Failed to remove bubble view", it) }
    }
    bubble = null
    bubbleParams = null
  }

  private fun moveBubble(dx: Int, dy: Int) {
    val b = bubble ?: return
    val params = bubbleParams ?: return
    val size = (BubbleView.SIZE_DP * resources.displayMetrics.density).toInt()
    val bounds = screenSize()

    // Clamped so a fling cannot park the chip off the edge where it can never
    // be dragged back.
    params.x = params.x.plus(dx).coerceIn(0, (bounds.first - size).coerceAtLeast(0))
    params.y = params.y.plus(dy).coerceIn(0, (bounds.second - size).coerceAtLeast(0))

    OverlayController.bubbleX = params.x
    OverlayController.bubbleY = params.y
    runCatching { windowManager?.updateViewLayout(b, params) }
      .onFailure { Log.w(TAG, "Failed to move bubble", it) }
  }

  /**
   * Brings the control panel to the front over the game.
   *
   * A background activity start is normally blocked from Android 10 onwards,
   * but holding SYSTEM_ALERT_WINDOW is one of the documented exemptions — and
   * this service cannot exist without that permission.
   */
  private fun openControlPanel() {
    OverlayController.dispatchBubbleTap()

    val launch = packageManager.getLaunchIntentForPackage(packageName)
    if (launch == null) {
      Log.w(TAG, "No launch intent for $packageName")
      return
    }
    launch.addFlags(
      Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED or
        Intent.FLAG_ACTIVITY_SINGLE_TOP
    )
    runCatching { startActivity(launch) }
      .onFailure { Log.w(TAG, "Failed to open the control panel", it) }
  }

  private fun defaultBubbleX(): Int {
    val size = (BubbleView.SIZE_DP * resources.displayMetrics.density).toInt()
    val margin = (12 * resources.displayMetrics.density).toInt()
    return (screenSize().first - size - margin).coerceAtLeast(0)
  }

  private fun defaultBubbleY(): Int =
    (screenSize().second * 0.22f).toInt()

  private fun screenSize(): Pair<Int, Int> {
    val wm = windowManager ?: return Pair(0, 0)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = wm.currentWindowMetrics.bounds
      Pair(bounds.width(), bounds.height())
    } else {
      val metrics = android.util.DisplayMetrics()
      @Suppress("DEPRECATION")
      wm.defaultDisplay.getRealMetrics(metrics)
      Pair(metrics.widthPixels, metrics.heightPixels)
    }
  }

  private fun overlayWindowType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_PHONE
    }

  private fun windowFlags(interactive: Boolean): Int {
    var flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
      WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
      WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED

    // Pass-through mode: touches go straight to whatever is underneath.
    if (!interactive) {
      flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    }
    return flags
  }

  private fun canDrawOverlays(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)

  // -- Foreground notification ----------------------------------------------

  private fun startForegroundCompat() {
    createChannel()

    val stopIntent = Intent(this, OverlayService::class.java).setAction(ACTION_STOP)
    val stopPending = PendingIntent.getService(
      this,
      0,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    val notification = builder
      .setContentTitle("Aim assistant overlay")
      .setContentText("Trajectory overlay is active")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .addAction(
        Notification.Action.Builder(null as Icon?, "Stop", stopPending).build()
      )
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return

    val channel = NotificationChannel(
      CHANNEL_ID,
      "Trajectory overlay",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Keeps the trajectory overlay running"
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  companion object {
    private const val TAG = "OverlayService"
    private const val CHANNEL_ID = "aim_assistant_overlay"
    private const val NOTIFICATION_ID = 0xA1_11
    const val ACTION_STOP = "expo.modules.overlaynative.STOP"
    const val EXTRA_INTERACTIVE = "interactive"
    const val EXTRA_BUBBLE = "bubble"
  }
}
