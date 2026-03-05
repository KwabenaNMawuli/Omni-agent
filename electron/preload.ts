/**
 * Preload Script — Secure IPC Bridge
 * Exposes a safe API to the renderer via contextBridge.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('omniAPI', {
    // Screen capture
    captureScreen: () => ipcRenderer.invoke('screen:capture'),
    getVisualBuffer: () => ipcRenderer.invoke('screen:get-buffer'),

    // Action execution
    executeAction: (action: any) => ipcRenderer.invoke('action:execute', action),
    waitForScreenStable: (opts?: { timeoutMs?: number; intervalMs?: number }) =>
        ipcRenderer.invoke('action:wait-for-stable', opts),
    onActionProgress: (callback: (data: any) => void) => {
        ipcRenderer.on('action:progress', (_event, data) => callback(data));
    },

    // Session
    getSessionState: () => ipcRenderer.invoke('session:state'),

    // System info
    getEnvInfo: () => ipcRenderer.invoke('system:env-info'),
    getScreenDimensions: () => ipcRenderer.invoke('system:screen-dimensions'),

    // Window click-through control
    setIgnoreMouseEvents: (ignore: boolean, opts?: { forward: boolean }) => {
        ipcRenderer.send('set-ignore-mouse-events', ignore, opts);
    },

    // Window focus control (needed for SpeechRecognition)
    setWindowFocusable: (focusable: boolean) => ipcRenderer.invoke('window:set-focusable', focusable),

    // Quit the app
    quitApp: () => {
        ipcRenderer.send('app:quit');
    },
});
