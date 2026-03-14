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
        focusable: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    });

    mainWindow.setMenu(null);
    // CRITICAL: make window un-focusable AFTER creation to prevent focus stealing without triggering the white titlebar bug
    mainWindow.setFocusable(false);

    // Ensure it sits above absolutely everything, including fullscreen apps
    // Removed 'screen-saver' setting because on Windows this forces the native white title bar to reappear
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

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

// Allow the renderer to temporarily make the window focusable.
// Needed for Web Speech API (SpeechRecognition) which often fails in unfocusable windows.
ipcMain.handle('window:set-focusable', (_event, focusable: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        mainWindow.setFocusable(!!focusable);
        if (focusable) {
            mainWindow.showInactive();
        }
    } catch (e) {
        console.warn('Failed to set window focusable:', e);
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
        // We no longer hide the overlay during screen capture so it stays visible

        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width, height } // Match actual screen resolution
        });

        // No need to restore overlay visibility

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
        // Error handling fallback
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
    const interval = opts?.intervalMs ?? 1500;  // Increased to 1500ms to reduce CPU load and mouse stutter
    const startTime = Date.now();
    let previousDataUrl: string | null = null;

    while (Date.now() - startTime < timeout) {
        try {
            // We no longer hide the overlay during wait-for-stable

            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: 480, height: 270 } // Low-res for fast comparison
            });

            // No need to restore overlay

            if (sources.length > 0) {
                const currentDataUrl = sources[0].thumbnail.toDataURL();

                if (previousDataUrl !== null && currentDataUrl === previousDataUrl) {
                    // Two consecutive frames are identical — screen is stable
                    return { stable: true, elapsed: Date.now() - startTime };
                }
                previousDataUrl = currentDataUrl;
            }
        } catch {
            // Error handling fallback
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
app.whenReady().then(() => {
    createWindow();

    // Aggressively enforce always-on-top so the overlay correctly floats over
    // heavy IDEs, Chrome, and exclusive fullscreen apps on Windows architectures.
    setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(true);
        }
    }, 1500);
});

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
// Removed per instruction to eliminate startup load and intermittent captures.
