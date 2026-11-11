// Atualização automática a partir das Releases do próprio repositório (davidosanjoss/apollo).
// Nada é baixado ou instalado sem o usuário aceitar.
import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { EventEmitter } from 'node:events';
import { retargetDesktopEntry } from './default-browser';
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

/**
 * Ambiente sem o que aponta para a montagem do AppImage antigo (desmontada quando ele
 * fecha), variáveis do AppImage e as que o Chromium grava no processo dele. Herdadas,
 * faziam o Chromium do Apollo novo cair ao iniciar ("Zygote process exited prematurely").
 */
export function cleanAppImageEnv(src: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...src };
  const mount = src.APPDIR;
  // Variáveis do AppImage e as que o Chromium grava no próprio processo (o novo as recria).
  // CHROME_DESKTOP herdado derrubava o zygote do Apollo novo (achado num teste real).
  for (const k of ['APPIMAGE', 'APPDIR', 'OWD', 'ARGV0', 'APPIMAGE_SILENT_INSTALL', 'APPIMAGE_EXIT_AFTER_INSTALL',
    'CHROME_DESKTOP', 'EGL_PLATFORM', 'FC_FONTATIONS', 'NO_AT_BRIDGE']) delete env[k];
  if (!mount) return env;
  for (const [k, v] of Object.entries(env)) {
    if (!v || !v.includes(mount)) continue;
    const parts = v.split(':');
    if (parts.length > 1) {
      const kept = parts.filter((p) => !p.startsWith(mount));
      if (kept.length) { env[k] = kept.join(':'); continue; }
    }
    delete env[k];
  }
  return env;
}

/**
 * Abre o AppImage novo depois que este processo terminar. O app.relaunch do Electron não
 * serve aqui: o auxiliar dele roda de dentro do AppImage montado, que é desmontado quando o
 * Apollo antigo fecha (visto num teste real: nada reabria). Um /bin/sh do sistema espera
 * este processo sair e então abre o arquivo novo, com o ambiente limpo do AppImage antigo.
 */
export function relaunchAfterExit(appImage: string, pid = process.pid): void {
  const env = cleanAppImageEnv(process.env);
  // Testes: APOLLO_TEST_RELAUNCH_LOG guarda a saída do processo de espera e do Apollo novo.
  const log = process.env.APOLLO_TEST_RELAUNCH_LOG;
  const out = log ? fs.openSync(log, 'a') : 'ignore';
  const child = spawn('/bin/sh', ['-c', 'echo "esperando $1"; while kill -0 "$1" 2>/dev/null; do sleep 0.3; done; echo "abrindo $2"; exec "$2"',
    'apollo-relaunch', String(pid), appImage], { detached: true, stdio: ['ignore', out, out], env });
  child.unref();
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
  // Testes do fluxo real de atualização: um servidor local no lugar do GitHub.
  if (process.env.APOLLO_TEST_UPDATE_FEED) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.APOLLO_TEST_UPDATE_FEED });

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
      const appImage = process.env.APPIMAGE;
      if (process.platform === 'linux' && appImage) {
        // AppImage: troca o arquivo sem abrir a versão nova agora (o Apollo antigo ainda está
        // aberto e a trava de instância única a faria desistir) e pede ao Electron para abri-la
        // DEPOIS que este processo terminar. Se o arquivo mudou de nome, a entrada do menu
        // passa a apontar para ele.
        let destination = appImage;
        (autoUpdater as unknown as EventEmitter).once('appimage-filename-updated', (p: string) => { destination = p; });
        autoUpdater.quitAndInstall(true, false);
        if (destination !== appImage) {
          try { retargetDesktopEntry(destination, appImage); } catch { /* sem entrada no menu: nada a fazer */ }
        }
        relaunchAfterExit(destination);
        return;
      }
      autoUpdater.quitAndInstall(false, true); // Windows: instalador, e o Apollo abre de novo
    },
  };
}
