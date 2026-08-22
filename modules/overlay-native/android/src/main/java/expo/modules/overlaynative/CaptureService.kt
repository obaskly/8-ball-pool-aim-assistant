package expo.modules.overlaynative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.drawable.Icon
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import android.view.WindowManager
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.roundToInt

/**
 * Coordination point between the Expo module (which lives on the JS thread) and
 * the capture service (which lives in its own process-wide lifecycle).
 *
 * The service cannot hold a reference to the module directly — it is started by
 * an Intent and outlives any particular module instance — so the module parks
 * its callbacks here and clears them on teardown.
 */
object CaptureController {
  private val configRef = AtomicReference(CaptureConfig())

  var config: CaptureConfig
    get() = configRef.get()
    set(value) = configRef.set(value)

  @Volatile
  var isRunning: Boolean = false
    private set

  /** Called on the analysis thread, once per analysed frame. */
  var onAnalysis: ((AnalysisResult) -> Unit)? = null

  /** Called when capture starts or stops, with a reason on failure. */
  var onStateChange: ((Boolean, String?) -> Unit)? = null

  internal fun publishState(running: Boolean, reason: String?) {
    isRunning = running
    onStateChange?.invoke(running, reason)
  }

  internal fun publish(result: AnalysisResult) {
    onAnalysis?.invoke(result)
  }
}

/**
 * Mirrors the display through MediaProjection and runs [TableAnalyzer] over the
 * frames.
 *
 * Separate from [OverlayService] on purpose: from Android 14 a foreground
 * service may only do what its declared `foregroundServiceType` allows, and
 * `mediaProjection` and `specialUse` cannot be combined on one service without
 * granting the overlay service capture rights it does not need.
 *
 * Two ordering rules that are easy to get wrong and fail only on newer Android:
 *
 *  - `startForeground()` must complete *before* `getMediaProjection()`, or
 *    Android 14+ throws SecurityException.
 *  - `MediaProjection.Callback` must be registered *before* `createVirtualDisplay()`,
 *    or API 34+ throws IllegalStateException.
 */
class CaptureService : Service() {

  private var projection: MediaProjection? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private var thread: HandlerThread? = null
  private var handler: Handler? = null

  private val analyzer = TableAnalyzer()
  private var frameIndex = 0L
  private var lastFrameAt = 0L
  private var captureWidth = 0
  private var captureHeight = 0
  private var screenWidth = 0
  private var screenHeight = 0
  private var busy = false

  private val projectionCallback = object : MediaProjection.Callback() {
    override fun onStop() {
      // The user revoked the session from the system UI, or the OS reclaimed it.
      Log.i(TAG, "MediaProjection stopped by the system")
      stopWithReason("capture stopped")
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null || intent.action == ACTION_STOP) {
      stopWithReason(null)
      return START_NOT_STICKY
    }

    // Must be foreground *before* the projection token is redeemed.
    startForegroundCompat()

    if (projection != null) return START_NOT_STICKY

    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
    val data: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(EXTRA_RESULT_DATA)
    }

    if (data == null) {
      stopWithReason("missing projection token")
      return START_NOT_STICKY
    }

    try {
      start(resultCode, data)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to start capture", e)
      stopWithReason(e.message ?: "failed to start capture")
      return START_NOT_STICKY
    }

    CaptureController.publishState(true, null)
    return START_NOT_STICKY
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    // A rotation changes the display bounds; the virtual display and reader have
    // to be rebuilt or every frame afterwards is stretched.
    val (w, h) = displaySize()
    if (w != screenWidth || h != screenHeight) {
      runCatching { rebuildPipeline() }
        .onFailure { Log.e(TAG, "Failed to rebuild capture pipeline", it) }
    }
  }

  override fun onDestroy() {
    teardown()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  // -- Pipeline --------------------------------------------------------------

  private fun start(resultCode: Int, data: Intent) {
    val manager =
      getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val projection = manager.getMediaProjection(resultCode, data)
      ?: throw IllegalStateException("projection token rejected")
    this.projection = projection

    val thread = HandlerThread("aim-capture", android.os.Process.THREAD_PRIORITY_DISPLAY)
    thread.start()
    this.thread = thread
    this.handler = Handler(thread.looper)

    // Register before createVirtualDisplay, which API 34+ enforces.
    projection.registerCallback(projectionCallback, handler)

    buildPipeline(projection)
  }

  private fun buildPipeline(projection: MediaProjection) {
    val (w, h) = displaySize()
    screenWidth = w
    screenHeight = h

    val scale = CaptureController.config.scale.coerceIn(0.2, 1.0)
    captureWidth = (w * scale).roundToInt().coerceAtLeast(160)
    captureHeight = (h * scale).roundToInt().coerceAtLeast(160)

    // maxImages = 2 keeps one frame in flight while the analyser holds the other.
    // Anything more just adds latency between the screen and the overlay.
    val reader = ImageReader.newInstance(
      captureWidth,
      captureHeight,
      PixelFormat.RGBA_8888,
      2
    )
    reader.setOnImageAvailableListener(::onImageAvailable, handler)
    imageReader = reader

    virtualDisplay = projection.createVirtualDisplay(
      "aim-capture",
      captureWidth,
      captureHeight,
      resources.displayMetrics.densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      reader.surface,
      null,
      handler
    )
  }

  private fun rebuildPipeline() {
    val projection = this.projection ?: return
    virtualDisplay?.release()
    virtualDisplay = null
    imageReader?.close()
    imageReader = null
    buildPipeline(projection)
  }

  private fun onImageAvailable(reader: ImageReader) {
    if (busy) return
    val image = try {
      reader.acquireLatestImage()
    } catch (e: Exception) {
      Log.w(TAG, "acquireLatestImage failed", e)
      null
    } ?: return

    busy = true
    try {
      val config = CaptureController.config
      val minInterval = (1000.0 / config.fps.coerceIn(1.0, 60.0)).toLong()
      val now = android.os.SystemClock.uptimeMillis()
      if (now - lastFrameAt < minInterval) return
      lastFrameAt = now

      val plane = image.planes[0]
      // The virtual display is captureWidth wide; only the analysis scale maps
      // back to screen space, so derive it from the real screen instead of the
      // requested scale, which was rounded.
      val toScreen = screenWidth.toFloat() / captureWidth

      val result = analyzer.analyze(
        buffer = plane.buffer,
        width = captureWidth,
        height = captureHeight,
        rowStride = plane.rowStride,
        pixelStride = plane.pixelStride,
        toScreen = toScreen,
        frameIndex = frameIndex++,
        config = config
      )
      CaptureController.publish(result)
    } catch (e: Exception) {
      Log.w(TAG, "Frame analysis failed", e)
    } finally {
      image.close()
      busy = false
    }
  }

  private fun displaySize(): Pair<Int, Int> {
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = wm.currentWindowMetrics.bounds
      bounds.width() to bounds.height()
    } else {
      val metrics = resources.displayMetrics
      metrics.widthPixels to metrics.heightPixels
    }
  }

  private fun stopWithReason(reason: String?) {
    CaptureController.publishState(false, reason)
    stopSelf()
  }

  private fun teardown() {
    runCatching { virtualDisplay?.release() }
    virtualDisplay = null

    runCatching { imageReader?.setOnImageAvailableListener(null, null) }
    runCatching { imageReader?.close() }
    imageReader = null

    projection?.let {
      runCatching { it.unregisterCallback(projectionCallback) }
      runCatching { it.stop() }
    }
    projection = null

    thread?.quitSafely()
    thread = null
    handler = null

    if (CaptureController.isRunning) CaptureController.publishState(false, null)
  }

  // -- Foreground notification ------------------------------------------------

  private fun startForegroundCompat() {
    createChannel()

    val stopIntent = Intent(this, CaptureService::class.java).setAction(ACTION_STOP)
    val stopPending = PendingIntent.getService(
      this,
      1,
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
      .setContentTitle("Reading the table")
      .setContentText("Screen capture is active")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .addAction(Notification.Action.Builder(null as Icon?, "Stop", stopPending).build())
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
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
      "Table reader",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Reads ball positions from the screen"
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  companion object {
    private const val TAG = "CaptureService"
    private const val CHANNEL_ID = "aim_assistant_capture"
    private const val NOTIFICATION_ID = 0xA1_12
    const val ACTION_STOP = "expo.modules.overlaynative.STOP_CAPTURE"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_RESULT_DATA = "resultData"
  }
}
