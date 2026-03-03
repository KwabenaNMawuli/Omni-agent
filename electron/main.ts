/**
 * Electron Main Process
 * Creates a transparent, frameless, always-on-top overlay window.
 * Manages IPC communication between renderer and native modules.
 */
import { app, BrowserWindow, ipcMain, desktopCapturer, screen } from 'electron';
import path from 'path';
import { VisualMemoryBuffer } from './visualMemory';
import { ActionExecutor } from './actionExecutor';
import { SessionController } from './sessionController';

// Workaround for "Network service crashed" on Windows
app.commandLine.appendSwitch('--no-sandbox');

let mainWindow: BrowserWindow | null = null;
const visualMemory = new VisualMemoryBuffer(8); // 8-frame rolling buffer
const actionExecutor = new ActionExecutor();
const sessionController = new SessionController();

function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size; // Use full display size, not workAreaSize

    mainWindow = new BrowserWindow({
        width: width,
        height: height,
        x: 0,
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // In development, load from Vite dev server
    if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools({ mode: 'detach' });

        // Retry if the page fails to load (e.g. network service crash)
        mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
            console.error(`Page failed to load: ${errorCode} - ${errorDescription}. Retrying in 2s…`);
            setTimeout(() => {
                mainWindow?.loadURL('http://localhost:3000');
            }, 2000);
        });
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Enable click-through for transparent areas — the renderer will
    // toggle this off when the mouse enters interactive UI elements
    mainWindow.setIgnoreMouseEvents(true, { forward: true });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Allow the renderer to toggle mouse event forwarding
ipcMain.on('set-ignore-mouse-events', (_event, ignore: boolean, opts?: { forward: boolean }) => {
    if (mainWindow) {
        mainWindow.setIgnoreMouseEvents(ignore, opts || {});
    }
});

// Quit the app
ipcMain.on('app:quit', () => {
    app.quit();
});

// ── IPC Handlers ──

// Capture current screen — hides the overlay first so the AI never sees its own UI
ipcMain.handle('screen:capture', async () => {
    try {
        // Hide the overlay so it doesn't appear in the screenshot
        if (mainWindow && mainWindow.isVisible()) {
            mainWindow.hide();
            // Small delay to ensure the OS finishes removing the window from the compositor
            await new Promise(r => setTimeout(r, 150));
        }

        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width, height } // Match actual screen resolution
        });

        // Show the overlay again — use showInactive() to avoid stealing focus
        // from the terminal or app the user is watching
        if (mainWindow) {
            mainWindow.showInactive();
            mainWindow.setAlwaysOnTop(true);
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
        }

        if (sources.length > 0) {
            const screenshot = sources[0].thumbnail.toDataURL();

            // Add to visual memory buffer
            visualMemory.addFrame({
                image: screenshot,
                timestamp: new Date().toISOString(),
                appName: 'Desktop',
                windowTitle: sources[0].name,
                index: visualMemory.getNextIndex(),
            });

            return screenshot;
        }
        return null;
    } catch (error) {
        console.error('Screen capture error:', error);
        // Ensure overlay is re-shown even on error
        if (mainWindow) {
            mainWindow.showInactive();
            mainWindow.setAlwaysOnTop(true);
            mainWindow.setIgnoreMouseEvents(true, { forward: true });
        }
        return null;
    }
});

// Get visual memory buffer
ipcMain.handle('screen:get-buffer', () => {
    return visualMemory.getFrames();
});

// Execute an action via nut.js
ipcMain.handle('action:execute', async (_event, action) => {
    try {
        const result = await actionExecutor.execute(action);
        // Broadcast progress to renderer
        mainWindow?.webContents.send('action:progress', {
            action,
            status: 'complete',
            result,
        });
        return result;
    } catch (error) {
        mainWindow?.webContents.send('action:progress', {
            action,
            status: 'error',
            error: String(error),
        });
        throw error;
    }
});

/**
 * Wait for screen visual stability.
 * Hides the overlay before each snapshot so the overlay's own animations
 * don't cause false "screen changed" detections.
 * Resolves when two consecutive frames match or when the timeout is reached.
 */
ipcMain.handle('action:wait-for-stable', async (_event, opts?: { timeoutMs?: number; intervalMs?: number }) => {
    const timeout = opts?.timeoutMs ?? 15000;  // Default 15s max wait
    const interval = opts?.intervalMs ?? 800;  // Check every 800ms
    const startTime = Date.now();
    let previousDataUrl: string | null = null;

    while (Date.now() - startTime < timeout) {
        try {
            // Hide the overlay so its animations don't contaminate the comparison
            if (mainWindow && mainWindow.isVisible()) {
                mainWindow.hide();
                await new Promise(r => setTimeout(r, 80));
            }

            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: 480, height: 270 } // Low-res for fast comparison
            });

            // Re-show overlay without stealing focus
            if (mainWindow) {
                mainWindow.showInactive();
                mainWindow.setAlwaysOnTop(true);
                mainWindow.setIgnoreMouseEvents(true, { forward: true });
            }

            if (sources.length > 0) {
                const currentDataUrl = sources[0].thumbnail.toDataURL();

                if (previousDataUrl !== null && currentDataUrl === previousDataUrl) {
                    // Two consecutive frames are identical — screen is stable
                    return { stable: true, elapsed: Date.now() - startTime };
                }
                previousDataUrl = currentDataUrl;
            }
        } catch {
            // Ensure overlay is re-shown even on error
            if (mainWindow) {
                mainWindow.showInactive();
                mainWindow.setAlwaysOnTop(true);
                mainWindow.setIgnoreMouseEvents(true, { forward: true });
            }
        }

        await new Promise(r => setTimeout(r, interval));
    }

    // Timed out — proceed anyway
    return { stable: false, elapsed: Date.now() - startTime };
});

// Get session state
ipcMain.handle('session:state', () => {
    return sessionController.getState();
});

// Get environment info
ipcMain.handle('system:env-info', async () => {
    const dims = actionExecutor.getScreenDimensions();
    return {
        os: `${process.platform} ${process.arch}`,
        shell: process.env.SHELL || process.env.ComSpec || 'unknown',
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        screenWidth: dims.width,
        screenHeight: dims.height,
        scaleFactor: dims.scaleFactor,
    };
});

// Get screen dimensions directly
ipcMain.handle('system:screen-dimensions', () => {
    return actionExecutor.getScreenDimensions();
});

// ── App Lifecycle ──
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// ── Background Screenshot Capture ──
// Periodic fallback capture every 5 seconds (Phase 3 of spec)
let captureInterval: NodeJS.Timeout;

app.on('ready', () => {
    captureInterval = setInterval(async () => {
        if (sessionController.getState() !== 'Idle') return; // Only capture when idle

        try {
            // Hide overlay so background captures are clean
            if (mainWindow && mainWindow.isVisible()) {
                mainWindow.hide();
                await new Promise(r => setTimeout(r, 100));
            }

            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: 960, height: 540 } // Lower res for background
            });

            // Re-show overlay without stealing focus
            if (mainWindow) {
                mainWindow.showInactive();
                mainWindow.setAlwaysOnTop(true);
                mainWindow.setIgnoreMouseEvents(true, { forward: true });
            }

            if (sources.length > 0) {
                visualMemory.addFrame({
                    image: sources[0].thumbnail.toDataURL(),
                    timestamp: new Date().toISOString(),
                    appName: 'Desktop',
                    windowTitle: sources[0].name,
                    index: visualMemory.getNextIndex(),
                });
            }
        } catch (e) {
            // Ensure overlay is re-shown even on error
            if (mainWindow) {
                mainWindow.showInactive();
                mainWindow.setAlwaysOnTop(true);
                mainWindow.setIgnoreMouseEvents(true, { forward: true });
            }
        }
    }, 10000);
});

app.on('before-quit', () => {
    clearInterval(captureInterval);
});
