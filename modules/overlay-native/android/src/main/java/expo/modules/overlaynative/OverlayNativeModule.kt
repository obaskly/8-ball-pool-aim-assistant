package expo.modules.overlaynative

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val OVERLAY_PERMISSION_REQUEST = 0x0A11
private const val CAPTURE_PERMISSION_REQUEST = 0x0A12

class OverlayNativeModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var pendingPermission: Promise? = null
  private var pendingCapture: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("OverlayNative")

    Events(EVENT_STATE, EVENT_TOUCH, EVENT_FRAME, EVENT_CAPTURE_STATE, EVENT_BUBBLE)

    OnCreate {
      OverlayController.onStateChange = { visible ->
        sendEvent(EVENT_STATE, mapOf("visible" to visible))
      }
      OverlayController.onTouch = { phase, x, y ->
        sendEvent(EVENT_TOUCH, mapOf("phase" to phase, "x" to x, "y" to y))
      }
      OverlayController.onBubbleTap = {
        sendEvent(EVENT_BUBBLE, emptyMap<String, Any>())
      }
      CaptureController.onAnalysis = { result ->
        sendEvent(EVENT_FRAME, result.toMap())
      }
      CaptureController.onStateChange = { running, reason ->
        sendEvent(EVENT_CAPTURE_STATE, mapOf("running" to running, "reason" to reason))
      }
    }

    OnDestroy {
      OverlayController.onStateChange = null
      OverlayController.onTouch = null
      OverlayController.onBubbleTap = null
      CaptureController.onAnalysis = null
      CaptureController.onStateChange = null
    }

    // -- Permission ---------------------------------------------------------

    Function("checkOverlayPermission") {
      canDrawOverlays()
    }

    /**
     * Opens the system "Display over other apps" screen and resolves with the
     * permission state once the user comes back.
     *
     * The settings screen always returns RESULT_CANCELED, so the result code is
     * ignored and the permission is re-read instead. With no activity available
     * the intent is still launched, but the promise resolves immediately with the
     * current (pre-grant) state and JS should re-check on resume.
     */
    AsyncFunction("requestOverlayPermission") { promise: Promise ->
      if (canDrawOverlays()) {
        promise.resolve(true)
        return@AsyncFunction
      }

      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${context.packageName}")
      )

      val activity = appContext.currentActivity
      if (activity == null) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        promise.resolve(false)
        return@AsyncFunction
      }

      pendingPermission?.resolve(canDrawOverlays())
      pendingPermission = promise
      activity.startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST)
    }

    OnActivityResult { _, payload ->
      when (payload.requestCode) {
        OVERLAY_PERMISSION_REQUEST -> {
          pendingPermission?.resolve(canDrawOverlays())
          pendingPermission = null
        }

        CAPTURE_PERMISSION_REQUEST -> {
          val promise = pendingCapture
          pendingCapture = null
          val data = payload.data

          if (promise == null) {
            // Nothing to answer to.
          } else if (payload.resultCode != android.app.Activity.RESULT_OK || data == null) {
            promise.resolve(false)
          } else {
            val intent = Intent(context, CaptureService::class.java)
              .putExtra(CaptureService.EXTRA_RESULT_CODE, payload.resultCode)
              .putExtra(CaptureService.EXTRA_RESULT_DATA, data)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
              context.startForegroundService(intent)
            } else {
              context.startService(intent)
            }
            promise.resolve(true)
          }
        }
      }
    }

    // -- Screen capture -----------------------------------------------------

    /**
     * Tuning for the frame analyser. Safe to call while capture is running; the
     * next frame picks it up. Changing `scale` only takes effect on restart,
     * because the virtual display is sized once.
     */
    Function("setCaptureConfig") { config: CaptureConfig ->
      CaptureController.config = config
    }

    /**
     * Asks for the screen-capture consent dialog and starts the capture service
     * with the token. Resolves false if the user declines.
     *
     * The consent token is single-use — Android will not let a stopped session be
     * resumed — so this has to be called again after every stop.
     */
    AsyncFunction("startCapture") { config: CaptureConfig?, promise: Promise ->
      if (config != null) CaptureController.config = config

      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(
          "ERR_NO_ACTIVITY",
          "Screen capture consent needs a foreground activity.",
          null
        )
        return@AsyncFunction
      }

      val manager = context
        .getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager

      pendingCapture?.resolve(false)
      pendingCapture = promise
      activity.startActivityForResult(
        manager.createScreenCaptureIntent(),
        CAPTURE_PERMISSION_REQUEST
      )
    }

    AsyncFunction("stopCapture") { promise: Promise ->
      context.stopService(Intent(context, CaptureService::class.java))
      promise.resolve(true)
    }

    Function("isCapturing") {
      CaptureController.isRunning
    }

    // -- Overlay lifecycle --------------------------------------------------

    AsyncFunction("showOverlay") { interactive: Boolean?, promise: Promise ->
      if (!canDrawOverlays()) {
        promise.reject(
          "ERR_OVERLAY_PERMISSION",
          "Draw-over-other-apps permission has not been granted.",
          null
        )
        return@AsyncFunction
      }

      val intent = Intent(context, OverlayService::class.java)
        .putExtra(OverlayService.EXTRA_INTERACTIVE, interactive ?: false)
        .putExtra(OverlayService.EXTRA_BUBBLE, OverlayController.bubbleVisible)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      promise.resolve(true)
    }

    AsyncFunction("hideOverlay") { promise: Promise ->
      context.stopService(Intent(context, OverlayService::class.java))
      promise.resolve(true)
    }

    Function("isOverlayVisible") {
      OverlayController.isRunning
    }

    // -- Floating chip ------------------------------------------------------

    /**
     * Shows or hides the draggable chip that reopens this panel from inside the
     * game. Remembered across a stop and start of the overlay.
     */
    Function("setBubbleVisible") { visible: Boolean ->
      OverlayController.bubbleVisible = visible
    }

    Function("isBubbleVisible") {
      OverlayController.bubbleVisible
    }

    // -- Rendering ----------------------------------------------------------

    Function("setScene") { scene: SceneRecord ->
      OverlayController.push(scene.toDrawScene())
    }

    Function("clearScene") {
      OverlayController.push(DrawScene.EMPTY)
    }

    /**
     * Interactive mode lets the overlay receive touches; pass-through mode (the
     * default) lets every touch reach the app underneath.
     */
    Function("setInteractive") { interactive: Boolean ->
      OverlayController.setInteractive(interactive)
    }

    // -- Geometry -----------------------------------------------------------

    /**
     * Real display size in physical pixels, including the area behind the system
     * bars and cutout, which is what the overlay window actually covers.
     */
    Function("getDisplayMetrics") {
      val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
      val density = context.resources.displayMetrics.density

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val bounds = wm.currentWindowMetrics.bounds
        mapOf(
          "width" to bounds.width(),
          "height" to bounds.height(),
          "density" to density
        )
      } else {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        mapOf(
          "width" to metrics.widthPixels,
          "height" to metrics.heightPixels,
          "density" to density
        )
      }
    }
  }

  private fun canDrawOverlays(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

  companion object {
    private const val EVENT_STATE = "onOverlayStateChange"
    private const val EVENT_TOUCH = "onOverlayTouch"
    private const val EVENT_FRAME = "onFrameAnalyzed"
    private const val EVENT_CAPTURE_STATE = "onCaptureStateChange"
    private const val EVENT_BUBBLE = "onBubbleTap"
  }
}
