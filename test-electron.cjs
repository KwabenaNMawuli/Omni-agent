const electron = require('electron');
console.log('Electron module type:', typeof electron);
console.log('Keys in electron module:', electron && typeof electron === 'object' ? Object.keys(electron).join(', ') : 'N/A');
console.log('ipcMain:', electron.ipcMain ? 'present' : 'undefined');
console.log('process.versions:', process.versions);
if (electron.app) {
    electron.app.whenReady().then(() => {
        console.log('Electron app is ready. Quitting.');
        electron.app.quit();
    });
} else {
    console.log('Not in Electron app context!');
}
