// Atualização automática a partir das Releases do próprio repositório (davidosanjoss/apollo).
// Nada é baixado ou instalado sem o usuário aceitar.
import { app } from 'electron';
import type { UpdateStatus } from '../shared/types';

const FIRST_CHECK_DELAY = 15_000; // não pesa na abertura
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 h

export interface Updater {
  download(): void;
  install(): void;
}

function canAutoUpdate(): boolean {
  if (!app.isPackaged) return false;
  // No Linux só o AppImage se atualiza; tar.gz/pacotes atualizam manualmente.
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  return true;
}

export function canSelfUpdate(): boolean {
  return canAutoUpdate();
}

export function setupUpdater(onStatus: (status: UpdateStatus | null) => void, beforeInstall: () => void): Updater {
  if (!canAutoUpdate()) return { download() {}, install() {} };

  // Carregado só no app empacotado (fica fora do bundle; vem de node_modules).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = console;

  let stage: UpdateStatus['stage'] | null = null;
  autoUpdater.on('update-available', (info) => { stage = 'available'; onStatus({ stage, version: info.version }); });
  autoUpdater.on('download-progress', (p) => { stage = 'downloading'; onStatus({ stage, percent: Math.round(p.percent) }); });
  autoUpdater.on('update-downloaded', (info) => { stage = 'downloaded'; onStatus({ stage, version: info.version }); });
  autoUpdater.on('error', (err) => {
    console.warn('[apollo] atualização falhou:', err.message);
    // Só incomoda o usuário se ele já estava no meio de uma atualização.
    if (stage === 'downloading') onStatus({ stage: 'error' });
    stage = null;
  });

  const check = () => { autoUpdater.checkForUpdates().catch(() => {}); };
  setTimeout(check, FIRST_CHECK_DELAY);
  setInterval(check, CHECK_INTERVAL);

  return {
    // "Baixar e instalar" na janela de versão nova pode vir antes de o autoUpdater ter
    // visto a versão (verificações separadas): verifica e baixa.
    download: () => {
      if (stage === 'available') { autoUpdater.downloadUpdate().catch(() => {}); return; }
      if (stage === null) autoUpdater.checkForUpdates().then((r) => (r?.isUpdateAvailable ? autoUpdater.downloadUpdate() : null)).catch(() => {});
    },
    install: () => {
      if (stage !== 'downloaded') return;
      beforeInstall();
      autoUpdater.quitAndInstall();
    },
  };
}
