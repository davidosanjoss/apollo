import { app, BrowserWindow, clipboard, components, ipcMain, net, powerMonitor, safeStorage, screen, session } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { openDatabase } from './db';
import { Store } from './store';
import { Browser } from './browser';
import { shortcutFor } from './shortcuts';
import { NetworkPipeline, gpcModule, type RequestContext } from './network';
import { Blocker, blockerModule } from './privacy/blocker';
import { parseFeatures } from './privacy/cosmetics';
import { thirdPartyCookiesModule, urlCleaningModule } from './privacy/modules';
import { DEFAULT_TOGGLES } from './privacy/rules';
import { loadEngines, scheduleFilterUpdates } from './privacy/filters';
import { registerApolloScheme, serveApolloScheme, UI_URL } from './protocol';
import { isTrustedSender, parseCommand } from './ipc';
import type { UiCommand } from '../shared/types';
import { loadSettings, applyDns, saveSettings, type Settings } from './settings';
import { canSelfUpdate, setupUpdater } from './updater';
import { RELEASES_API, UpdateCheck } from './update-check';
import { runDiagnose } from './diagnose';
import type { SecretBox } from './secret-box';
import { resolveWindowState } from './window-state';
import { BitwardenApi, serverUrls } from './vault/api';
import { VaultService } from './vault/service';
import { parseSpellcheck, spellcheckLanguages } from './spellcheck';

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
  // Gerenciamento de cor do Wayland (wp_color_manager_v1): compositores como o KWin
  // recusam a função de transferência que o Chromium pede e o log se enche de
  // "Unable to set image transfer function". Sem ele, a janela fica em sRGB (como já
  // estava na prática); só HDR no Wayland deixaria de ser descrito ao compositor.
  app.commandLine.appendSwitch('disable-features', 'WaylandWpColorManagerV1');
}

// Sem "Electron/x" e "apollo/x" no user agent: alguns sites (Microsoft, Google)
// tratam UA de Electron como navegador desconhecido/inseguro.
const cleanUA = app.userAgentFallback.replace(/\sElectron\/\S+/i, '').replace(/\sapollo\/\S+/i, '');
app.userAgentFallback = cleanUA;

// Erro não tratado no processo principal: o Electron abriria uma caixa de diálogo que
// trava o navegador inteiro. Registra e segue (um módulo com bug não derruba tudo).
process.on('uncaughtException', (err) => console.error('[apollo] erro não tratado:', err));
process.on('unhandledRejection', (err) => console.error('[apollo] promessa rejeitada sem tratamento:', err));

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

/**
 * Chaveiro do sistema (API assíncrona: a síncrona foi descontinuada pelo Electron).
 * Sem chaveiro de verdade (basic_text no Linux), devolve null: nada sensível é salvo.
 */
async function systemSecretBox(): Promise<SecretBox | null> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
  if (process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())) {
    console.warn('[apollo] sem chaveiro do sistema: cookies de sessão e Bitwarden não serão lembrados entre reinícios');
    return null;
  }
  return {
    encrypt: (s) => safeStorage.encryptStringAsync(s),
    decrypt: async (b) => (await safeStorage.decryptStringAsync(b)).result,
  };
}

function readWindowState(store: Store) {
  let saved: unknown = null;
  try { saved = JSON.parse(store.getKv('window') ?? 'null'); } catch { /* padrão */ }
  return resolveWindowState(saved, screen.getAllDisplays().map((d) => d.workArea));
}

function createWindow(store: Store, box: SecretBox | null): { win: BrowserWindow; browser: Browser } {
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
  const togglesFor = (ctx: RequestContext, firstParty: string | null) => browser?.privacyForRequest(ctx, firstParty) ?? DEFAULT_TOGGLES;
  const pipeline = new NetworkPipeline(
    [
      urlCleaningModule(togglesFor),
      blockerModule(blocker, { togglesFor, onBlocked: (ctx, kind) => browser?.onBlocked(ctx, kind) }),
      thirdPartyCookiesModule(togglesFor),
      // GPC obedece ao gerenciador de módulos.
      { ...gpcModule, onBeforeSendHeaders: (d, h, c) => { if (browser?.isModuleOn('gpc') !== false) gpcModule.onBeforeSendHeaders!(d, h, c); } },
    ],
    (id) => browser?.tabIdOfWebContentsId(id) ?? null,
    (tabId) => browser?.tabUrlOf(tabId) ?? null,
  );
  browser = new Browser(win, store, pipeline, box);
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

  // Filtros cosméticos pedidos pelo preload das abas. Só aceita o frame principal de
  // uma aba; a URL vem do próprio frame (não do que a página diz).
  const cosmeticsFor = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, features?: unknown) => {
    const tabId = b.tabIdOf(event.sender);
    const frame = event.senderFrame;
    if (!tabId || !frame || frame !== event.sender.mainFrame) return null;
    if (!b.isModuleOn('cosmetics') || !b.privacyForTab(tabId, frame.url)?.ads) return null;
    const parsed = features === undefined ? undefined : parseFeatures(features);
    if (parsed === null) return null;
    const result = blocker.cosmetics(frame.url, parsed);
    if (result?.styles) void event.sender.insertCSS(result.styles, { cssOrigin: 'user' }).catch(() => {});
    return result;
  };
  ipcMain.on('apollo:cosmetics-start', (event) => {
    try {
      const r = cosmeticsFor(event);
      event.returnValue = r ? { scripts: r.scripts } : null;
    } catch {
      event.returnValue = null; // nunca travar a página
    }
  });
  ipcMain.handle('apollo:cosmetics-dom', (event, features) => { cosmeticsFor(event, features); });

  // Notificações: o que o site enxerga (só o frame principal de uma aba ou painel).
  ipcMain.on('apollo:notification-state', (event) => {
    try {
      const frame = event.senderFrame;
      event.returnValue = frame && frame === event.sender.mainFrame ? b.notificationState(event.sender, frame.url) : null;
    } catch {
      event.returnValue = null;
    }
  });
  ipcMain.on('apollo:notification-click', (event) => {
    if (event.senderFrame === event.sender.mainFrame) b.showFromNotification(event.sender);
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

  // Corretor da sessão padrão (interface) conforme a escolha salva, antes de a janela
  // carregar: senão o Chromium baixa o dicionário em inglês mesmo com o corretor desligado.
  {
    const langs = spellcheckLanguages(parseSpellcheck(store.getKv('spellcheck')));
    session.defaultSession.setSpellCheckerLanguages(langs);
    session.defaultSession.setSpellCheckerEnabled(langs.length > 0);
  }
  const box = await systemSecretBox();
  const { win, browser } = createWindow(store, box);
  // Só nos testes de integração (com o inspetor do Node ligado pelo harness).
  if (process.env.APOLLO_TEST_HOOKS) Object.assign(globalThis, { __apolloTest: { browser, clipboard: () => clipboard.readText() } });

  // Bitwarden: requisições pela rede do Chromium (respeita o DNS seguro/Zero Trust).
  const vault = new VaultService(
    store.vaultStorage(),
    box,
    (server, deviceId) => new BitwardenApi(serverUrls(server), (u, i) => net.fetch(u, i), { id: deviceId, name: 'Apollo', type: 14 }),
    () => browser.setVault(vault.info()),
    () => randomUUID(),
  );
  browser.setVault(vault.info());
  browser.setVaultProvider({
    status: () => vault.status(),
    vault: () => vault.unlocked,
    saveLogin: (l) => vault.saveLogin(l),
    updatePassword: (id, p) => vault.updatePassword(id, p),
  });
  // Logins enviados nas abas (preload): só do frame principal de uma aba; URL do próprio frame.
  const fromTabFrame = (event: Electron.IpcMainEvent) => {
    const tabId = browser.tabIdOf(event.sender);
    const frame = event.senderFrame;
    return tabId && frame && frame === event.sender.mainFrame ? { tabId, url: frame.url } : null;
  };
  const text = (v: unknown, max = 1024) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
  ipcMain.on('apollo:login-submitted', (event, data: { username?: unknown; password?: unknown }) => {
    const src = fromTabFrame(event);
    const password = text(data?.password);
    if (src && password) browser.onLoginSubmitted(src.tabId, src.url, text(data?.username), password);
  });
  ipcMain.on('apollo:username-step', (event, username: unknown) => {
    const src = fromTabFrame(event);
    const u = text(username);
    if (src && u) browser.onUsernameStep(src.tabId, src.url, u);
  });
  // Bloqueio automático: tela bloqueada, suspensão e tempo ocioso do sistema.
  powerMonitor.on('lock-screen', () => vault.lock());
  powerMonitor.on('suspend', () => vault.lock());
  setInterval(() => vault.checkIdle(powerMonitor.getSystemIdleTime()), 30_000).unref();
  setInterval(() => { if (vault.unlocked) void vault.sync(); }, 30 * 60_000).unref();

  // DNS: o que está em uso, e mudanças pela tela de configurações.
  let settings: Settings = loadSettings();
  const showDns = (info: { provider?: string }) =>
    browser.setSettings({ dns: { mode: settings.dns.mode, dohUrl: settings.dns.dohUrl, provider: info.provider ?? null } });
  showDns(dnsInfo);
  const testDns = async () => {
    browser.setSettings({ dnsTest: { status: 'testing' } });
    const t0 = Date.now();
    try {
      const res = await session.defaultSession.fetch('https://example.com/', { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
      browser.setSettings({ dnsTest: res.ok ? { status: 'ok', ms: Date.now() - t0 } : { status: 'fail', error: `HTTP ${res.status}` } });
    } catch (err) {
      browser.setSettings({ dnsTest: { status: 'fail', error: (err as Error).message } });
    }
  };

  const updater = setupUpdater(
    (status) => browser.setUpdate(status),
    () => db.exec('PRAGMA wal_checkpoint(TRUNCATE)'),
  );
  // Versão nova / novidades: em qualquer instalação empacotada (ou numa API de teste).
  const updateCheck = new UpdateCheck({
    current: app.getVersion(),
    store,
    api: process.env.APOLLO_UPDATES_API || (app.isPackaged ? RELEASES_API : null),
    canInstall: canSelfUpdate(),
    onChange: () => browser.push(),
  });
  browser.updateCheck = updateCheck;
  updateCheck.start();

  ipcMain.on('ui:command', (event, raw) => {
    if (!isTrustedSender(event, win.webContents)) return;
    const cmd = parseCommand(raw);
    if (!cmd) return console.warn('[apollo] comando inválido da UI ignorado');
    try {
      runCommand(cmd);
    } catch (err) {
      // Um comando com bug nunca derruba o navegador (nem os dados no log: só o tipo).
      console.error(`[apollo] comando "${cmd.type}" falhou:`, err);
    }
  });

  const runCommand = (cmd: UiCommand): void => {
    if (cmd.type === 'update:download') return updater.download();
    if (cmd.type === 'update:install') return updater.install();
    if (cmd.type === 'update:check') return void updateCheck.check(true);
    if (cmd.type === 'update:dismiss') return updateCheck.dismiss();
    if (cmd.type === 'update:skip') return updateCheck.skip();
    if (cmd.type === 'update:open-page') { updateCheck.openPage(); return updateCheck.dismiss(); }
    if (cmd.type === 'settings:dns') {
      settings = { ...settings, dns: { mode: cmd.mode, dohUrl: cmd.dohUrl } };
      saveSettings(settings);
      browser.setSettings({ dnsTest: { status: 'idle' } });
      return showDns(applyDns(settings));
    }
    if (cmd.type === 'settings:test-dns') return void testDns();
    switch (cmd.type) {
      case 'vault:connect': return void vault.connect(cmd.server, cmd.clientId, cmd.clientSecret, cmd.password);
      case 'vault:unlock': return void vault.unlock(cmd.password);
      case 'vault:lock': return vault.lock();
      case 'vault:sync': return void vault.sync();
      case 'vault:disconnect': return vault.disconnect();
      case 'vault:lock-after': return vault.setLockAfter(cmd.minutes);
    }
    browser.handleCommand(cmd);
  };

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
    vault.lock();
    try { store.deleteTemporaryWorkspaces(); } catch { /* banco indisponível: apaga ao abrir */ }
    try { db.close(); } catch { /* já fechado */ }
  });
});

app.on('window-all-closed', () => {
  // No diagnóstico as janelas são temporárias; quem encerra é o próprio diagnóstico.
  if (!diagnoseArg) app.quit();
});
