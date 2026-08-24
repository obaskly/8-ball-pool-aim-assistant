import { NativeModule, registerWebModule } from 'expo';

import type {
  CaptureConfig,
  OverlayDisplayMetrics,
  OverlayNativeModuleEvents,
  OverlayPanelState,
  OverlayScene,
} from './OverlayNative.types';

/**
 * There is no system overlay on the web. This stub keeps the same shape so the
 * control panel can render in a browser during development: permission checks
 * report `false` and every draw call is a no-op.
 */
class OverlayNativeWebModule extends NativeModule<OverlayNativeModuleEvents> {
  checkOverlayPermission(): boolean {
    return false;
  }

  async requestOverlayPermission(): Promise<boolean> {
    return false;
  }

  async showOverlay(_interactive?: boolean): Promise<boolean> {
    throw new Error('The overlay is only available on Android.');
  }

  async hideOverlay(): Promise<boolean> {
    return true;
  }

  isOverlayVisible(): boolean {
    return false;
  }

  setBubbleVisible(_visible: boolean): void {}

  isBubbleVisible(): boolean {
    return false;
  }

  setPanelVisible(_visible: boolean): void {}

  isPanelVisible(): boolean {
    return false;
  }

  setPanelState(_state: OverlayPanelState): void {}

  setScene(_scene: OverlayScene): void {}

  clearScene(): void {}

  setInteractive(_interactive: boolean): void {}

  getDisplayMetrics(): OverlayDisplayMetrics {
    return {
      width: typeof window === 'undefined' ? 0 : window.innerWidth,
      height: typeof window === 'undefined' ? 0 : window.innerHeight,
      density: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    };
  }

  async startCapture(_config?: CaptureConfig): Promise<boolean> {
    throw new Error('Screen capture is only available on Android.');
  }

  async stopCapture(): Promise<boolean> {
    return true;
  }

  isCapturing(): boolean {
    return false;
  }

  setCaptureConfig(_config: CaptureConfig): void {}

  relearnCloth(): void {}
}

export default registerWebModule(OverlayNativeWebModule, 'OverlayNative');
