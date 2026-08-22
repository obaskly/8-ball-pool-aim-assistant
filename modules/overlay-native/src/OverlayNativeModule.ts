import { NativeModule, requireNativeModule } from 'expo';

import type {
  CaptureConfig,
  OverlayDisplayMetrics,
  OverlayNativeModuleEvents,
  OverlayScene,
} from './OverlayNative.types';

declare class OverlayNativeModule extends NativeModule<OverlayNativeModuleEvents> {
  /** True when "Display over other apps" is granted. Cheap; safe to poll. */
  checkOverlayPermission(): boolean;

  /**
   * Opens the system permission screen and resolves once the user returns.
   *
   * That screen always reports "cancelled", so the result is read back from
   * `Settings.canDrawOverlays` rather than from the result code. If no activity
   * is attached the screen is still opened but the promise resolves `false`
   * immediately, so re-check with `checkOverlayPermission()` on resume.
   */
  requestOverlayPermission(): Promise<boolean>;

  /**
   * Starts the foreground service and attaches the overlay window.
   * Rejects with `ERR_OVERLAY_PERMISSION` if the permission is missing.
   *
   * @param interactive `false` (default) passes every touch through to the app
   *   underneath. `true` routes touches to `onOverlayTouch` instead.
   */
  showOverlay(interactive?: boolean): Promise<boolean>;

  /** Stops the service and removes the window. Safe to call when not running. */
  hideOverlay(): Promise<boolean>;

  isOverlayVisible(): boolean;

  /**
   * Shows or hides the draggable chip that reopens this app from inside the
   * game. It lives in its own touchable window, so the trajectory overlay stays
   * pass-through while the chip is up. Remembered across overlay restarts.
   */
  setBubbleVisible(visible: boolean): void;

  isBubbleVisible(): boolean;

  /** Replaces the current frame and schedules a redraw. */
  setScene(scene: OverlayScene): void;

  clearScene(): void;

  /** Toggles touch pass-through without restarting the service. */
  setInteractive(interactive: boolean): void;

  getDisplayMetrics(): OverlayDisplayMetrics;

  /**
   * Shows the system screen-capture consent dialog and starts reading the
   * screen. Resolves `false` if the user declines.
   *
   * Android issues a single-use consent token, so this must be called again
   * after every `stopCapture()` — there is no way to resume a stopped session.
   * Analysed frames arrive on the `onFrameAnalyzed` event.
   */
  startCapture(config?: CaptureConfig): Promise<boolean>;

  stopCapture(): Promise<boolean>;

  isCapturing(): boolean;

  /**
   * Retunes the analyser. Takes effect on the next frame, except for `scale`,
   * which sizes the virtual display and only applies on the next start.
   */
  setCaptureConfig(config: CaptureConfig): void;
}

export default requireNativeModule<OverlayNativeModule>('OverlayNative');
