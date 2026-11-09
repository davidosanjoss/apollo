const { app, BrowserWindow, ipcMain, session, components, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { loadSettings, applyDns } = require('./settings');
const { setupUpdater } = require('./updater');

let mainWindow = null;

// Perfis: o app instalado usa ~/.config/apollo; o código em desenvolvimento (npm start)
// usa ~/.config/apollo-dev, para nunca mexer nos logins/sessão do uso real.
if (process.env.APOLLO_USER_DATA) {
  app.setPath('userData', process.env.APOLLO_USER_DATA);
} else if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'apollo-dev'));
}

// Páginas internas: apollo://home → src/pages/home/index.html
const PAGES_DIR = path.join(__dirname, 'pages');
protocol.registerSchemesAsPrivileged([
  { scheme: 'apollo', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function handleApolloProtocol(request) {
  const url = new URL(request.url);
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(PAGES_DIR, url.hostname, rel));
  // Bloqueia path traversal (apollo://home/../../main.js)
  if (!file.startsWith(PAGES_DIR + path.sep) || !fs.existsSync(file)) {
    return new Response('Página não encontrada', { status: 404 });
  }
  return net.fetch(pathToFileURL(file).toString());
}

const diagnoseArg = process.argv.find((a) => a.startsWith('--diagnose='));

// Decodificação de vídeo por hardware (VA-API) no Linux. No Windows já vem ligada (D3D11).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', [
    'AcceleratedVideoDecodeLinuxGL',
    'AcceleratedVideoDecodeLinuxZeroCopyGL',
    'AcceleratedVideoEncoder',
  ].join(','));
}

// Remove "Electron/x" e "apollo/x" do user agent: alguns sites (Microsoft, Google)
// tratam UA de Electron como navegador desconhecido/inseguro.
const cleanUA = app.userAgentFallback
  .replace(/\sElectron\/\S+/i, '')
  .replace(/\sapollo\/\S+/i, '');
app.userAgentFallback = cleanUA;
app.on('session-created', (s) => {
  s.setUserAgent(cleanUA);
  // Cada workspace é uma sessão própria; todas precisam servir as páginas internas.
  if (!s.protocol.isProtocolHandled('apollo')) s.protocol.handle('apollo', handleApolloProtocol);
});

const statePath = () => path.join(app.getPath('userData'), 'state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  const tmp = statePath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath());
}

// Atalhos que precisam funcionar mesmo com o foco dentro de uma página.
function shortcutFor(input) {
  if (input.type !== 'keyDown') return null;
  const mod = input.control || input.meta;
  const k = input.key.toLowerCase();
  if (mod && !input.shift && k === 't') return 'new-tab';
  if (mod && !input.shift && k === 'w') return 'close-tab';
  if (mod && !input.shift && k === 'l') return 'focus-address';
  if ((mod && k === 'r') || input.key === 'F5') return 'reload';
  if (mod && input.key === 'Tab') return input.shift ? 'prev-tab' : 'next-tab';
  if (input.alt && input.key === 'ArrowLeft') return 'back';
  if (input.alt && input.key === 'ArrowRight') return 'forward';
  if (mod && /^[1-9]$/.test(input.key)) return `workspace-${input.key}`;
  return null;
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;

  contents.on('before-input-event', (event, input) => {
    const action = shortcutFor(input);
    if (!action) return;
    event.preventDefault();
    contents.hostWebContents?.send('shortcut', action);
  });

  contents.setWindowOpenHandler(({ url, disposition }) => {
    // Links "abrir em nova aba" viram aba no mesmo workspace.
    if (disposition === 'foreground-tab' || disposition === 'background-tab') {
      contents.hostWebContents?.send('open-tab', {
        fromWebContentsId: contents.id,
        url,
        background: disposition === 'background-tab',
      });
      return { action: 'deny' };
    }
    // Popups (ex.: login OAuth/SSO) abrem como janela, MAS na mesma sessão do workspace.
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: { session: contents.session },
      },
    };
  });
});

ipcMain.handle('state:load', () => loadState());
ipcMain.handle('state:save', (_e, state) => saveState(state));
ipcMain.handle('workspace:clear-data', async (_e, partition) => {
  const s = session.fromPartition(partition);
  await s.clearStorageData();
  await s.clearCache();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 700,
    minHeight: 400,
    title: 'Apollo',
    backgroundColor: '#16161a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Atalhos com foco na própria UI (barra de endereço, sidebar).
  win.webContents.on('before-input-event', (event, input) => {
    const action = shortcutFor(input);
    if (!action || action === 'reload') return;
    event.preventDefault();
    win.webContents.send('shortcut', action);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
}

app.whenReady().then(async () => {
  const dnsInfo = applyDns(loadSettings());

  if (diagnoseArg) {
    const { runDiagnose } = require('./diagnose');
    return runDiagnose(diagnoseArg.split('=')[1], dnsInfo);
  }

  // Widevine (DRM: Netflix, Prime, Spotify…). Não bloqueia a abertura da janela.
  components.whenReady()
    .then(() => console.log('[apollo] componentes:', JSON.stringify(components.status())))
    .catch((err) => console.warn('[apollo] Widevine indisponível:', err.message));

  createWindow();
  setupUpdater(() => mainWindow);
});
app.on('window-all-closed', () => {
  // No diagnóstico as janelas são temporárias; quem encerra é o próprio diagnóstico.
  if (!diagnoseArg) app.quit();
});
