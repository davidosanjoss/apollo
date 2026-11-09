// Atualização automática a partir das Releases públicas (davidosanjoss/apollo-releases).
// Nada é baixado ou instalado sem o usuário aceitar.
const { app, ipcMain } = require('electron');

const FIRST_CHECK_DELAY = 15_000; // não pesa na abertura
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 h

function canAutoUpdate() {
  if (!app.isPackaged) return false;
  // No Linux só o AppImage se atualiza; tar.gz/pacotes atualizam manualmente.
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  return true;
}

function setupUpdater(getWindow) {
  ipcMain.handle('update:supported', () => canAutoUpdate());
  if (!canAutoUpdate()) return;

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = console;

  const send = (event, payload) => getWindow()?.webContents.send('update', { event, ...payload });

  autoUpdater.on('update-available', (info) => send('available', {
    version: info.version,
    notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
  }));
  autoUpdater.on('download-progress', (p) => send('progress', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send('downloaded', { version: info.version }));
  autoUpdater.on('error', (err) => {
    console.warn('[apollo] atualização falhou:', err.message);
    send('error', { message: err.message });
  });

  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
  // Fecha e instala; a sessão é restaurada ao reabrir.
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates().catch(() => null));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, FIRST_CHECK_DELAY);
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { setupUpdater };
