import { app, BrowserWindow, components, ipcMain, safeStorage, screen, session } from 'electron';
import path from 'node:path';
import { openDatabase } from './db';
import { Store } from './store';
import { Browser } from './browser';
import { shortcutFor } from './shortcuts';
import { NetworkPipeline, gpcModule } from './network';
import { Blocker, blockerModule } from './privacy/blocker';
import { loadEngines, scheduleFilterUpdates } from './privacy/filters';
import { registerApolloScheme, serveApolloScheme, UI_URL } from './protocol';
import { isTrustedSender, parseCommand } from './ipc';
import { loadSettings, applyDns } from './settings';
import { setupUpdater } from './updater';
import { runDiagnose } from './diagnose';
import type { Cipher } from './session-cookies';
import { resolveWindowState } from './window-state';

// ------------------------------------------------------------ perfil
// App instalado: ~/.config/apollo. Desenvolvimento (npm start): ~/.config/apollo-dev,
// para o código em desenvolvimento nunca mexer nos logins/sessão do uso real.
if (process.env.APOLLO_USER_DATA) {
  app.setPath('userData', process.env.APOLLO_USER_DATA);
} else if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'apollo-dev'));
}

const diagnoseArg = process.argv.find((a) => a.startsWith('--diagnose='));

// Duas instâncias no mesmo perfil corromperiam sessão e banco: a segunda só foca a primeira.
if (!diagnoseArg && !app.requestSingleInstanceLock()) {
  app.exit(0);
}

// ------------------------------------------------------------ Chromium

// Decodificação de vídeo por hardware (VA-API) no Linux. No Windows já vem ligada (D3D11).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', [
    'AcceleratedVideoDecodeLinuxGL',
    'AcceleratedVideoDecodeLinuxZeroCopyGL',
    'AcceleratedVideoEncoder',
  ].join(','));
}

// Sem "Electron/x" e "apollo/x" no user agent: alguns sites (Microsoft, Google)
// tratam UA de Electron como navegador desconhecido/inseguro.
const cleanUA = app.userAgentFallback.replace(/\sElectron\/\S+/i, '').replace(/\sapollo\/\S+/i, '');
app.userAgentFallback = cleanUA;

registerApolloScheme();

app.on('session-created', (ses) => {
  ses.setUserAgent(cleanUA);
  serveApolloScheme(ses);
});

// Nenhuma página pode embutir <webview> (só existiria se algo habilitasse webviewTag).
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (event) => event.preventDefault());
});

// ------------------------------------------------------------ janela

/** Cifra do chaveiro do sistema. Sem chaveiro de verdade (basic_text), não salva cookies de sessão. */
function systemCipher(): Cipher | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  if (process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())) {
    console.warn('[apollo] sem chaveiro do sistema: cookies de sessão não serão mantidos entre reinícios');
    return null;
  }
  return { encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) };
}

function readWindowState(store: Store) {
  let saved: unknown = null;
  try { saved = JSON.parse(store.getKv('window') ?? 'null'); } catch { /* padrão */ }
  return resolveWindowState(saved, screen.getAllDisplays().map((d) => d.workArea));
}

function createWindow(store: Store): { win: BrowserWindow; browser: Browser } {
  const state = readWindowState(store);
  const win = new BrowserWindow({
    ...(state.x !== undefined ? { x: state.x, y: state.y } : {}),
    width: state.width,
    height: state.height,
    minWidth: 700,
    minHeight: 400,
    title: 'Apollo',
    backgroundColor: '#16161a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // A UI nunca navega para outro lugar nem abre janelas.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  let browser: Browser | null = null;
  const blocker = new Blocker(loadEngines(app.getPath('userData')));
  scheduleFilterUpdates(app.getPath('userData'), (engines) => blocker.setEngines(engines));
  const pipeline = new NetworkPipeline(
    [blockerModule(blocker, {
      togglesFor: (ctx, sourceUrl) => browser?.privacyForRequest(ctx, sourceUrl) ?? { ads: true, trackers: true },
      onBlocked: (ctx, kind) => browser?.onBlocked(ctx, kind),
    }), gpcModule],
    (id) => browser?.tabIdOfWebContentsId(id) ?? null,
    (tabId) => browser?.tabUrlOf(tabId) ?? null,
  );
  browser = new Browser(win, store, pipeline, systemCipher());
  const b = browser;

  // Antes de a janela (e as abas) sumirem: grava histórico e posição.
  win.on('close', () => {
    b.flushHistory();
    const { x, y, width, height } = win.getNormalBounds();
    store.setKv('window', JSON.stringify({ x, y, width, height, maximized: win.isMaximized() }));
  });

  // Atalhos com foco na própria UI (barra de endereço, sidebar).
  win.webContents.on('before-input-event', (event, input) => {
    const action = shortcutFor(input);
    if (!action) return;
    event.preventDefault();
    b.runShortcut(action);
  });

  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize();
    win.show();
  });
  win.webContents.on('did-finish-load', () => b.start());
  win.loadURL(UI_URL);
  return { win, browser: b };
}

// ------------------------------------------------------------ boot

app.whenReady().then(async () => {
  serveApolloScheme(session.defaultSession);
  const dnsInfo = applyDns(loadSettings());

  if (diagnoseArg) return runDiagnose(diagnoseArg.split('=')[1], dnsInfo);

  // Widevine (DRM: Netflix, Prime, Spotify…). Não bloqueia a abertura da janela.
  components.whenReady()
    .then(() => console.log('[apollo] componentes:', JSON.stringify(components.status())))
    .catch((err: Error) => console.warn('[apollo] Widevine indisponível:', err.message));

  const userData = app.getPath('userData');
  const db = openDatabase(path.join(userData, 'apollo.db'));
  const store = new Store(db);
  if (store.importLegacyState(path.join(userData, 'state.json'))) {
    console.log('[apollo] estado da v0.1 migrado para o banco (backup: state.json.migrated)');
  }

  const { win, browser } = createWindow(store);

  const updater = setupUpdater(
    (status) => browser.setUpdate(status),
    () => db.exec('PRAGMA wal_checkpoint(TRUNCATE)'),
  );

  ipcMain.on('ui:command', (event, raw) => {
    if (!isTrustedSender(event, win.webContents)) return;
    const cmd = parseCommand(raw);
    if (!cmd) return console.warn('[apollo] comando inválido da UI ignorado');
    if (cmd.type === 'update:download') return updater.download();
    if (cmd.type === 'update:install') return updater.install();
    browser.handleCommand(cmd);
  });

  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // Cookies de sessão: a cada 5 min (protege contra queda) e ao fechar.
  setInterval(() => void browser.saveSessionCookies(), 5 * 60_000).unref();
  let saved = false;
  app.on('before-quit', (event) => {
    if (saved) return;
    event.preventDefault();
    const timeout = new Promise((r) => setTimeout(r, 3000));
    void Promise.race([browser.saveSessionCookies(), timeout]).finally(() => {
      saved = true;
      app.quit();
    });
  });

  app.on('will-quit', () => {
    try { db.close(); } catch { /* já fechado */ }
  });
});

app.on('window-all-closed', () => {
  // No diagnóstico as janelas são temporárias; quem encerra é o próprio diagnóstico.
  if (!diagnoseArg) app.quit();
});
