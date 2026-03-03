/**
 * Screen Capture Engine
 * Manages screenshot acquisition triggers based on observable UI changes.
 * Uses Electron's desktopCapturer API.
 */

export interface CaptureConfig {
    thumbnailWidth: number;
    thumbnailHeight: number;
    format: 'image/png' | 'image/webp';
    quality: number; // 0-1 for WebP
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
    thumbnailWidth: 1280,
    thumbnailHeight: 720,
    format: 'image/webp',
    quality: 0.7,
};

/**
 * Capture trigger types as defined in the spec:
 * - Active Window Change
 * - Application Switch
 * - Window Creation or Closure
 * - User Input Burst (mouse click or keypress)
 * - Periodic Fallback Capture
 */
export type CaptureTrigger =
    | 'window_change'
    | 'app_switch'
    | 'window_lifecycle'
    | 'input_burst'
    | 'periodic_fallback';

export interface CaptureMetadata {
    trigger: CaptureTrigger;
    timestamp: string;
    appName: string;
    windowTitle: string;
}

/**
 * ScreenCaptureEngine manages triggering and performing screen captures.
 * In the web app mode, captures are done via html2canvas.
 * In Electron mode, uses desktopCapturer.
 */
export class ScreenCaptureEngine {
    private config: CaptureConfig;
    private lastCaptureTime: number = 0;
    private minCaptureInterval: number = 1000; // Min 1s between captures

    constructor(config: CaptureConfig = DEFAULT_CAPTURE_CONFIG) {
        this.config = config;
    }

    /**
     * Check if enough time has passed since the last capture
     * to avoid redundant frames.
     */
    canCapture(): boolean {
        return Date.now() - this.lastCaptureTime >= this.minCaptureInterval;
    }

    /**
     * Record that a capture was performed.
     */
    markCaptured(): void {
        this.lastCaptureTime = Date.now();
    }

    getConfig(): CaptureConfig {
        return this.config;
    }
}
