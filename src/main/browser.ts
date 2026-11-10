import path from 'node:path';
import { app, BrowserWindow, clipboard, desktopCapturer, Menu, WebContentsView, session, type MenuItemConstructorOptions, type Session, type WebContents } from 'electron';
import type { Bookmark, Store, Tab, Workspace } from './store';
import { withNavigation, type TabHistory } from './history';
import { effectiveTimeout, pickTabsToHibernate, type HibernationCandidate } from './hibernation';
import { memoryBreakdown } from './memory';
import { ALL_OFF, DEFAULT_TOGGLES, resolve as resolvePrivacy, siteOf, type Overrides, type Resolved } from './privacy/rules';
import type { BlockKind } from './privacy/blocker';
import { privacyMenu } from './privacy/menu';
import { permissionsMenu } from './permissions-menu';
import type { MenuModelItem } from './menu-model';
import { vaultMenu } from './vault/menu';
import { MODULES, parseModules } from './modules';
import { customizationsFor } from './customizations';
import { parseSpellcheck, spellcheckLanguages } from './spellcheck';

/** Mundo isolado das personalizações do usuário: vê o DOM, não vê a página nem o Apollo. */
const USER_SCRIPT_WORLD = 1001;
import { loginsFor, uriMatches } from './vault/match';
import { parseTotp, totp } from './vault/totp';
import type { NewLogin, UnlockedVault } from './vault/vault';
import { decideSave, itemName, type SaveDecision } from './vault/save';
import { DEFAULT_GENERATOR, generatePassword } from './vault/generator';

/** O que o Browser precisa do cofre (o VaultService implementa). */
export interface VaultProvider {
  status(): 'disconnected' | 'locked' | 'unlocked';
  vault(): UnlockedVault | null;
  saveLogin(login: NewLogin): Promise<boolean | null>;
  updatePassword(id: string, password: string): Promise<boolean | null>;
}

interface PendingSave {
  id: string;
  url: string;
  username: string | null;
  password: string;
  at: number;
  decision: SaveDecision | undefined; // undefined = ainda não decidido (cofre bloqueado)
}

const SAVE_PROMPT_TTL_MS = 5 * 60_000;

const CLIPBOARD_CLEAR_MS = 30_000;

/** Promessa com prazo: se o sistema não responder, segue sem ela (null). */
const within = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
import type { RequestContext } from './network';
import { joinGroupInPlace, moveTab, normalize, setGroup, setPinned, type OrderTab } from './tab-order';
import { captureSessionCookies, restoreSessionCookies, type Cipher } from './session-cookies';
import { newId } from './store';
import { normalizeUrl } from '../shared/url';
import { DownloadManager } from './downloads';
import { nextZoom, zoomKey, zoomPercent } from './zoom';
import { buildContextMenu, type ContextAction, type ContextInfo, type ContextItem } from './context-menu';
import type { NetworkPipeline } from './network';
import { PermissionManager, originOf } from './permissions';
import { shortcutFor, type ShortcutAction } from './shortcuts';
import type { MemoryReport, ModuleId, PermissionDecision, ScreenPickerInfo, ScreenSource, SpellcheckMode, PanelInfo, PrivacyFeature, SettingsInfo, SitePrivacy, TabInfo, UiCommand, UiEvent, UiState, UpdateStatus, VaultStatusInfo } from '../shared/types';
import { GROUP_COLORS, PANEL_DEFAULT_WIDTH, PANEL_HIBERNATE_OPTIONS_MIN } from '../shared/types';
import { APOLLO_HOME, isHomeUrl } from '../shared/types';


const MAX_CLOSED_TABS = 25;

/** Regras salvas de uma camada, com null onde não há regra (herda). */
const nullable = (o: Overrides): Record<PrivacyFeature, boolean | null> =>
  Object.fromEntries((Object.keys(DEFAULT_TOGGLES) as PrivacyFeature[]).map((f) => [f, o[f] ?? null])) as Record<PrivacyFeature, boolean | null>;

// Só para testes: acelerar o relógio da hibernação (ver tests/e2e/hibernation.test.ts).
const minuteMs = () => Number(process.env.APOLLO_TEST_MINUTE_MS) || 60_000;
const hibernationTickMs = () => Number(process.env.APOLLO_TEST_HIBERNATION_TICK_MS) || 60_000;

interface ClosedTab {
  workspaceId: string;
  index: number;
  url: string;
  title: string;
  history: TabHistory | null;
  groupId: string | null;
}

/**
 * Dono de workspaces, abas e do layout. Cada aba é um WebContentsView do processo
 * principal, numa sessão isolada do seu workspace, em sandbox e sem acesso à UI.
 * Abas só ganham uma view quando são ativadas (abrir o navegador não carrega tudo).
 */
export class Browser {
  private readonly views = new Map<string, WebContentsView>();
  private readonly tabByWebContents = new Map<number, string>();
  private readonly loading = new Set<string>();
  /** Workspaces com sessão configurada → promessa de "cookies de sessão restaurados". */
  private readonly sessionsReady = new Map<string, Promise<void>>();
  private readonly historyTimers = new Map<string, NodeJS.Timeout>();
  /** Abas com histórico sendo restaurado: não sobrescrever o salvo com um parcial. */
  private readonly restoring = new Set<string>();
  /** Abas com view criada esperando os cookies de sessão para carregar. */
  private readonly awaitingLoad = new Set<string>();
  private closedTabs: ClosedTab[] = [];

  // Hibernação
  /** Quando cada aba saiu da tela pela última vez. */
  private readonly lastSeen = new Map<string, number>();
  /** Abas tocando áudio/vídeo. */
  private readonly playing = new Set<string>();
  /** Abas cuja página recusou sair (beforeunload) — não tentar de novo até serem vistas. */
  private readonly unloadBlocked = new Set<string>();
  private hibernationTimer: NodeJS.Timeout | null = null;

  // Privacidade
  /** Camadas salvas por workspace|site (consultadas a cada requisição: cache em memória). */
  private readonly privacyCache = new Map<string, { global: Overrides; workspace: Overrides; site: Overrides }>();
  /** Abas com a proteção pausada (temporário, até fechar). */
  private readonly pausedTabs = new Set<string>();
  private readonly blocked = new Map<string, { ads: number; trackers: number }>();
  private blockedPushTimer: NodeJS.Timeout | null = null;

  // Configurações (DNS): o index.ts aplica e informa aqui.
  private settings: Omit<SettingsInfo, 'privacy' | 'spellcheck' | 'downloadAsk' | 'historyOn' | 'bookmarkBar'> = {
    dns: { mode: 'secure', dohUrl: null, provider: null },
    dnsTest: { status: 'idle' },
  };

  // Monitor de memória: só mede enquanto aberto.
  private memoryTimer: NodeJS.Timeout | null = null;
  private memoryReport: MemoryReport | null = null;
  private readonly permissions: PermissionManager;

  private activeWorkspaceId: string;
  private attachedTabId: string | null = null;
  private bounds = { x: 0, y: 0, width: 0, height: 0 };
  private overlayOpen = false;
  private update: UpdateStatus | null = null;
  private pushScheduled = false;

  constructor(
    private readonly win: BrowserWindow,
    private readonly store: Store,
    private readonly pipeline: NetworkPipeline,
    /** null = sem chaveiro do sistema: cookies de sessão não são salvos. */
    private readonly cipher: Cipher | null = null,
  ) {
    this.permissions = new PermissionManager(store, (wc) => this.tabIdOf(wc), () => this.push());
    // Temporários de uma execução anterior (ex.: o app caiu) não sobrevivem.
    store.deleteTemporaryWorkspaces();
    store.pruneHistory();

    if (store.listWorkspaces().length === 0) {
      store.createWorkspace({ id: newId(), name: 'Principal', color: '#7c5cff', home: APOLLO_HOME });
    }
    const saved = store.getKv('activeWorkspaceId');
    this.activeWorkspaceId = (saved && store.getWorkspace(saved)) ? saved : store.listWorkspaces()[0].id;
    this.ensureHasTab(this.activeWorkspaceId);

    win.on('resize', () => this.layout());
    // Saiu da tela cheia pelo sistema (tecla do gerenciador de janelas): a interface volta.
    win.on('leave-full-screen', () => {
      if (!this.windowFullscreen) return;
      this.windowFullscreen = false;
      this.push();
    });
  }

  // ------------------------------------------------------------ consultas

  tabIdOf(wc: WebContents | null | undefined): string | null {
    return wc ? this.tabByWebContents.get(wc.id) ?? null : null;
  }

  tabIdOfWebContentsId(id: number | undefined): string | null {
    return id === undefined ? null : this.tabByWebContents.get(id) ?? null;
  }

  private activeWorkspace(): Workspace {
    return this.store.getWorkspace(this.activeWorkspaceId)!;
  }

  private activeTab(): Tab | null {
    const ws = this.activeWorkspace();
    return ws.activeTabId ? this.store.getTab(ws.activeTabId) : null;
  }

  // ------------------------------------------------------------ sessões

  /** Partição da sessão: persistente em disco, ou só em memória (workspace temporário). */
  private partitionOf(workspaceId: string): string {
    return this.store.getWorkspace(workspaceId)?.temporary ? `ws-temp-${workspaceId}` : `persist:ws-${workspaceId}`;
  }

  sessionFor(workspaceId: string): Session {
    const ses = session.fromPartition(this.partitionOf(workspaceId));
    if (!this.sessionsReady.has(workspaceId)) {
      this.permissions.attach(ses, workspaceId);
      this.pipeline.attach(ses, workspaceId);
      this.applySpellcheck(ses);
      this.downloads.attach(ses);
      ses.setDisplayMediaRequestHandler((request, callback) => { void this.handleDisplayMedia(request, callback); });
      this.sessionsReady.set(workspaceId, this.restoreCookies(ses, workspaceId));
    }
    return ses;
  }

  private async restoreCookies(ses: Session, workspaceId: string): Promise<void> {
    // Só para testes: simula um chaveiro lento (ver tests/e2e/session.test.ts).
    const delay = Number(process.env.APOLLO_TEST_SESSION_RESTORE_DELAY_MS);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const data = this.cipher && this.store.loadSessionCookies(workspaceId);
    if (!data || !this.cipher) return;
    const n = await restoreSessionCookies(ses, data, this.cipher).catch(() => 0);
    if (n) console.log(`[apollo] ${n} cookies de sessão restaurados (workspace ${workspaceId})`);
  }

  /** Salva os cookies de sessão de todos os workspaces abertos nesta execução. */
  async saveSessionCookies(): Promise<void> {
    if (!this.cipher) return;
    const cipher = this.cipher;
    await Promise.all([...this.sessionsReady.keys()].map(async (workspaceId) => {
      const ws = this.store.getWorkspace(workspaceId);
      if (!ws || ws.temporary) return; // excluído, ou temporário (nada vai para o disco)
      try {
        const data = await captureSessionCookies(session.fromPartition(this.partitionOf(workspaceId)), cipher);
        this.store.saveSessionCookies(workspaceId, data);
      } catch (err) {
        console.warn('[apollo] falha ao salvar cookies de sessão:', (err as Error).message);
      }
    }));
  }

  // ------------------------------------------------------------ abas

  private ensureHasTab(workspaceId: string): void {
    const ws = this.store.getWorkspace(workspaceId)!;
    const tabs = this.store.listTabs(workspaceId);
    if (tabs.length === 0) {
      this.createTab(workspaceId, ws.home, { activate: true });
    } else if (!ws.activeTabId || !tabs.some((t) => t.id === ws.activeTabId)) {
      this.store.setActiveTab(workspaceId, tabs[0].id);
    }
  }

  createTab(workspaceId: string, url: string | null, opts: { activate: boolean; afterTabId?: string | null }): Tab {
    const ws = this.store.getWorkspace(workspaceId)!;
    const afterId = opts.afterTabId ?? ws.activeTabId;
    const tab = this.store.insertTab({ id: newId(), workspaceId, url: url || ws.home || APOLLO_HOME, title: 'Nova aba' }, afterId);
    // Aberta a partir de uma aba de grupo EXPANDIDO: entra no grupo. Grupo recolhido: nasce
    // fora, depois do bloco dele (normalize). Ao lado de fixada: vai para depois delas.
    const after = afterId ? this.store.getTab(afterId) : null;
    const joinGroup = after?.groupId && !after.pinned && !this.store.getGroup(after.groupId)?.collapsed ? after.groupId : null;
    this.reorder(workspaceId, (tabs) => (joinGroup ? joinGroupInPlace(tabs, tab.id, joinGroup) : normalize(tabs)));
    if (opts.activate) {
      this.store.setActiveTab(workspaceId, tab.id);
      if (workspaceId === this.activeWorkspaceId) this.showActive();
    }
    this.push();
    return tab;
  }

  private ensureView(tab: Tab): WebContentsView {
    const existing = this.views.get(tab.id);
    if (existing) return existing;

    const view = new WebContentsView({
      webPreferences: {
        session: this.sessionFor(tab.workspaceId),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        // Filtros cosméticos/scriptlets do bloqueador (nada exposto à página).
        preload: path.join(__dirname, 'tab-preload.js'),
      },
    });
    view.setBackgroundColor('#ffffff');
    const wc = view.webContents;
    this.views.set(tab.id, view);
    this.tabByWebContents.set(wc.id, tab.id);
    this.wireTab(tab.id, tab.workspaceId, wc);
    void this.loadTab(tab, wc);
    return view;
  }

  /** Carrega a aba: espera os cookies de sessão e restaura o histórico (voltar/avançar). */
  private async loadTab(tab: Tab, wc: WebContents): Promise<void> {
    this.awaitingLoad.add(tab.id);
    try {
      await this.sessionsReady.get(tab.workspaceId);
    } finally {
      this.awaitingLoad.delete(tab.id);
    }
    if (wc.isDestroyed()) return;
    const history = this.store.getTab(tab.id)?.history ?? null;
    if (history) {
      this.restoring.add(tab.id);
      try {
        await wc.navigationHistory.restore({ index: history.index, entries: history.entries });
        return;
      } catch {
        // Interrompida porque o usuário já navegou (ex.: voltar enquanto carregava):
        // a página atual é a escolha dele, não recarregar a antiga por cima.
        if (wc.isDestroyed() || wc.navigationHistory.length() > 0) return;
        // Histórico inválido para o Chromium: carrega só a URL.
      } finally {
        this.restoring.delete(tab.id);
      }
    }
    wc.loadURL(this.store.getTab(tab.id)?.url ?? tab.url).catch(() => {}); // erros tratados em did-fail-load
  }

  // ------------------------------------------------------------ histórico

  private captureHistory(tabId: string): void {
    const timer = this.historyTimers.get(tabId);
    if (timer) { clearTimeout(timer); this.historyTimers.delete(tabId); }
    const wc = this.views.get(tabId)?.webContents;
    if (!wc || wc.isDestroyed() || this.restoring.has(tabId) || !this.store.getTab(tabId)) return;
    const entries = wc.navigationHistory.getAllEntries();
    if (entries.length === 0) return;
    this.store.setTabHistory(tabId, { index: wc.navigationHistory.getActiveIndex(), entries });
  }

  private scheduleHistorySave(tabId: string): void {
    if (this.historyTimers.has(tabId)) return;
    this.historyTimers.set(tabId, setTimeout(() => this.captureHistory(tabId), 1000));
  }

  /** Grava o histórico de todas as abas abertas (antes de fechar a janela). */
  flushHistory(): void {
    for (const tabId of this.views.keys()) this.captureHistory(tabId);
  }

  private wireTab(tabId: string, workspaceId: string, wc: WebContents): void {
    const update = (patch: Parameters<Store['updateTab']>[1]) => {
      this.store.updateTab(tabId, patch);
      this.scheduleHistorySave(tabId);
      this.push();
    };

    wc.on('page-title-updated', (_e, title) => {
      update({ title });
      if (this.historyOn(workspaceId)) this.store.setVisitTitle(workspaceId, wc.getURL(), title);
    });
    // Tela cheia pedida pela página (vídeo): o Electron põe a janela em tela cheia; a view
    // precisa cobrir a janela inteira (senão o vídeo fica preso no espaço da aba).
    wc.on('enter-html-full-screen', () => {
      this.pageFullscreenTabId = tabId;
      this.layout();
      this.push();
    });
    wc.on('leave-html-full-screen', () => {
      if (this.pageFullscreenTabId !== tabId) return;
      this.pageFullscreenTabId = null;
      if (this.windowFullscreen) this.win.setFullScreen(true); // F11 continua valendo
      this.layout();
      this.push();
    });
    // Ctrl + roda do mouse.
    wc.on('zoom-changed', (_e, dir) => this.zoom(wc, workspaceId, dir));
    wc.on('found-in-page', (_e, r) => {
      if (this.findState?.tabId !== tabId) return;
      this.findState = { ...this.findState, active: r.activeMatchOrdinal, matches: r.matches };
      this.push();
    });
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons[0] ?? null }));
    wc.on('did-navigate', (_e, url) => {
      // Código-fonte: o evento traz a URL de dentro; a aba guarda "view-source:…" (senão,
      // ao restaurar ou acordar da hibernação, abriria a página em vez do código).
      const shown = wc.getURL();
      this.applyZoom(wc, workspaceId, url);
      this.visit(workspaceId, url, '');
      if (shown.startsWith('view-source:')) update({ url: shown, title: shown });
      else if (!url.startsWith('apollo://error')) update({ url });

      this.unloadBlocked.delete(tabId);
      this.permissions.cancelForTab(tabId);
    });
    // Contador de bloqueios é por página. Zera no INÍCIO da navegação: as requisições
    // da página nova chegam pelo serviço de rede e podem ser contadas antes do evento
    // did-navigate (commit) — zerar ali apagava bloqueios já contados (visto no CI).
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.blocked.delete(tabId);
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      update({ url });
      this.visit(workspaceId, url, wc.getTitle());
    });
    wc.on('did-start-loading', () => { this.loading.add(tabId); this.push(); });
    wc.on('dom-ready', () => this.applyCustomizations(wc));
    wc.on('media-started-playing', () => { this.playing.add(tabId); });
    wc.on('media-paused', () => { this.playing.delete(tabId); });
    wc.on('did-stop-loading', () => { this.loading.delete(tabId); this.push(); });

    // Sem isso, um erro de rede deixa a aba em branco.
    wc.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ERR_ABORTED */) return;
      update({ url: validatedURL, title: 'Erro ao carregar' });
      const q = new URLSearchParams({ url: validatedURL, code: String(code), desc: description });
      wc.loadURL(`apollo://error/?${q}`).catch(() => {});
    });

    // Processo da página morreu: descarta a view; ela é recriada ao ativar.
    wc.on('render-process-gone', () => {
      this.destroyView(tabId);
      if (this.activeWorkspace().activeTabId === tabId) this.showActive();
    });

    wc.on('before-input-event', (event, input) => {
      const action = shortcutFor(input);
      if (!action) return;
      event.preventDefault();
      this.runShortcut(action);
    });
    wc.on('context-menu', (_e, params) => this.showPageMenu(wc, params, workspaceId, tabId));

    wc.setWindowOpenHandler(({ url, disposition }) => {
      // "Abrir em nova aba" → aba no mesmo workspace.
      if (disposition === 'foreground-tab' || disposition === 'background-tab') {
        this.createTab(workspaceId, url, { activate: disposition === 'foreground-tab', afterTabId: tabId });
        return { action: 'deny' };
      }
      // Popups (login OAuth/SSO) abrem como janela, na MESMA sessão do workspace.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: {
            session: this.sessionFor(workspaceId),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    });
  }

  /**
   * Fecha a página da aba (libera a memória). `graceful` (hibernação) respeita o
   * beforeunload: se a página recusar sair (formulário não enviado), ela continua viva.
   */
  private destroyView(tabId: string, graceful = false): void {
    const view = this.views.get(tabId);
    if (!view) return;
    this.captureHistory(tabId);
    const wc = view.webContents;
    const wcId = wc.id;
    const forget = () => {
      if (this.views.get(tabId) !== view) return;
      if (this.attachedTabId === tabId) {
        this.win.contentView.removeChildView(view);
        this.attachedTabId = null;
      }
      this.tabByWebContents.delete(wcId);
      this.views.delete(tabId);
      this.loading.delete(tabId);
      this.playing.delete(tabId);
      this.push();
    };
    if (wc.isDestroyed()) return forget();
    if (!graceful) {
      forget();
      // WebContentsView não libera a página sozinho: fechar explicitamente devolve a RAM.
      wc.close();
      return;
    }
    wc.once('destroyed', forget);
    wc.once('will-prevent-unload', () => {
      // Sem preventDefault: a saída é cancelada e a página continua como estava.
      this.unloadBlocked.add(tabId);
      this.push();
    });
    wc.close({ waitForBeforeUnload: true });
  }

  // ------------------------------------------------------------ hibernação

  /** Hiberna a aba (manual ignora tempo/sempre ativa/mídia, mas nunca a aba na tela). */
  hibernateTab(tabId: string, manual = false): void {
    const tab = this.store.getTab(tabId);
    if (!tab || !this.views.has(tabId) || tabId === this.attachedTabId) return;
    if (!manual && (tab.keepAwake || this.playing.has(tabId) || this.unloadBlocked.has(tabId))) return;
    this.permissions.cancelForTab(tabId);
    this.destroyView(tabId, true);
  }

  private hibernationSoon: NodeJS.Timeout | null = null;

  /** Ao sair de uma aba/workspace: roda a hibernação logo (para "ao sair" valer na hora). */
  private scheduleHibernation(): void {
    if (this.hibernationSoon) return;
    this.hibernationSoon = setTimeout(() => { this.hibernationSoon = null; this.hibernationTick(); }, 1500);
    this.hibernationSoon.unref();
  }

  private memoryInfo(): { usedMb: number; otherMb: number; perTab: Map<string, number> } {
    const metrics = app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, workingSetKb: m.memory.workingSetSize }));
    const tabs = [...this.views].map(([tabId, view]) => ({
      tabId,
      pid: view.webContents.isDestroyed() ? null : view.webContents.getOSProcessId(),
    }));
    const r = memoryBreakdown(metrics, tabs);
    return { usedMb: r.totalMb, otherMb: r.otherMb, perTab: r.perTabMb };
  }

  // ------------------------------------------------------------ privacidade

  /** URL atual da página da aba (barato: sem banco). */
  tabUrlOf(tabId: string): string | null {
    const wc = this.views.get(tabId)?.webContents;
    return wc && !wc.isDestroyed() ? wc.getURL() || null : null;
  }

  privacyFor(workspaceId: string, site: string | null, tabId: string | null): Resolved {
    const key = `${workspaceId}|${site ?? ''}`;
    let layers = this.privacyCache.get(key);
    if (!layers) {
      layers = this.store.getPrivacyLayers(workspaceId, site);
      this.privacyCache.set(key, layers);
    }
    const tab: Overrides = tabId && this.pausedTabs.has(tabId) ? ALL_OFF : {};
    return resolvePrivacy({ ...layers, tab });
  }

  /** Interruptores da aba (para os filtros cosméticos). null = não é aba. */
  privacyForTab(tabId: string, url: string) {
    const tab = this.store.getTab(tabId);
    return tab ? this.privacyFor(tab.workspaceId, siteOf(url), tabId).toggles : null;
  }

  /** Interruptores para uma requisição (chamado pelo bloqueador). */
  privacyForRequest(ctx: RequestContext, sourceUrl: string | null) {
    return this.privacyFor(ctx.workspaceId, siteOf(sourceUrl), ctx.tabId).toggles;
  }

  onBlocked(ctx: RequestContext, kind: BlockKind): void {
    if (!ctx.tabId) return;
    const c = this.blocked.get(ctx.tabId) ?? { ads: 0, trackers: 0 };
    c[kind]++;
    this.blocked.set(ctx.tabId, c);
    // Páginas bloqueiam dezenas de itens por segundo: atualiza o contador no máximo 2x/s.
    if (ctx.tabId === this.attachedTabId && !this.blockedPushTimer) {
      this.blockedPushTimer = setTimeout(() => { this.blockedPushTimer = null; this.push(); }, 500);
    }
  }

  setPrivacy(scope: 'global' | 'workspace' | 'site', feature: PrivacyFeature, enabled: boolean | null, workspaceId?: string): void {
    const site = scope === 'site' ? siteOf(this.activeTab()?.url) : null;
    if (scope === 'site' && !site) return;
    const ws = scope === 'workspace' && workspaceId ? workspaceId : this.activeWorkspaceId;
    if (!this.store.getWorkspace(ws)) return;
    this.store.setPrivacyRule(scope === 'global' ? null : ws, site, feature, enabled);
    this.privacyCache.clear();
    this.withActiveView((wc) => wc.reload()); // aplica na página atual
  }

  /** Remove todas as regras de proteção do site da aba ativa (volta ao padrão). */
  resetSitePrivacy(): void {
    const site = siteOf(this.activeTab()?.url);
    if (!site) return;
    for (const f of Object.keys(DEFAULT_TOGGLES) as PrivacyFeature[]) this.store.setPrivacyRule(this.activeWorkspaceId, site, f, null);
    this.privacyCache.clear();
    this.withActiveView((wc) => wc.reload());
  }

  /** Converte o modelo de menu (menu-model.ts) em menu nativo. */
  private toTemplate(items: MenuModelItem[]): MenuItemConstructorOptions[] {
    return items.map((item): MenuItemConstructorOptions => {
      switch (item.kind) {
        case 'info': return { label: item.label, enabled: false };
        case 'separator': return { type: 'separator' };
        case 'check': return { label: item.label, type: 'checkbox', checked: item.checked, enabled: item.enabled, click: this.run(item.command) };
        case 'radio': return { label: item.label, type: 'radio', checked: item.checked, click: this.run(item.command) };
        case 'action': return { label: item.label, enabled: item.enabled, click: this.run(item.command) };
        case 'submenu': return { label: item.label, submenu: this.toTemplate(item.items) };
      }
    });
  }

  showPrivacyMenu(x: number, y: number): void {
    const info = this.sitePrivacy(this.activeTab());
    if (info) this.popup(this.toTemplate(privacyMenu(info)), x, y);
  }

  showPermissionsMenu(x: number, y: number): void {
    const tab = this.activeTab();
    const info = tab && this.permissions.siteInfo(tab.workspaceId, tab.url);
    if (info) this.popup(this.toTemplate(permissionsMenu(info)), x, y);
  }

  pauseTab(paused: boolean): void {
    const tab = this.activeTab();
    if (!tab) return;
    if (paused) this.pausedTabs.add(tab.id);
    else this.pausedTabs.delete(tab.id);
    this.withActiveView((wc) => wc.reload());
  }

  private sitePrivacy(tab: Tab | null): SitePrivacy | null {
    const site = siteOf(tab?.url);
    if (!tab || !site) return null;
    const { toggles, source } = this.privacyFor(tab.workspaceId, site, tab.id);
    const rules = this.store.getPrivacyLayers(tab.workspaceId, site).site;
    return {
      site,
      toggles,
      source,
      siteRules: nullable(rules),
      tabPaused: this.pausedTabs.has(tab.id),
      blocked: this.blocked.get(tab.id) ?? { ads: 0, trackers: 0 },
    };
  }

  // ------------------------------------------------------------ tela cheia, imprimir, devtools

  private windowFullscreen = false;
  private pageFullscreenTabId: string | null = null;

  /** F11: janela em tela cheia sem a interface (abas, barra, laterais). */
  toggleFullscreen(): void {
    this.windowFullscreen = !this.windowFullscreen;
    this.win.setFullScreen(this.windowFullscreen);
    this.push();
  }

  private withActiveWc(fn: (wc: WebContents) => void): void {
    const tab = this.activeTab();
    const wc = tab ? this.views.get(tab.id)?.webContents : undefined;
    if (wc && !wc.isDestroyed()) fn(wc);
  }

  private print(wc: WebContents): void {
    wc.print({}, (ok, reason) => { if (!ok && reason !== 'cancelled') console.warn('[apollo] impressão falhou:', reason); });
  }

  private toggleDevTools(wc: WebContents): void {
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' }); // view não tem onde "acoplar": janela própria
  }

  // ------------------------------------------------------------ zoom por site

  private zoomActive(dir: 'in' | 'out' | 'reset'): void {
    const tab = this.activeTab();
    const wc = tab ? this.views.get(tab.id)?.webContents : undefined;
    if (tab && wc && !wc.isDestroyed()) this.zoom(wc, tab.workspaceId, dir);
  }

  /** Muda e guarda o zoom do site (outras abas do mesmo site no workspace acompanham). */
  private zoom(wc: WebContents, workspaceId: string, dir: 'in' | 'out' | 'reset'): void {
    const factor = dir === 'reset' ? 1 : nextZoom(wc.getZoomFactor(), dir);
    wc.setZoomFactor(factor);
    const key = zoomKey(wc.getURL());
    if (key) this.store.setZoom(workspaceId, key, factor);
    this.push();
  }

  /** Ao abrir uma página: o zoom guardado do site (o Chromium só lembra até fechar o app). */
  private applyZoom(wc: WebContents, workspaceId: string, url: string): void {
    const key = zoomKey(url);
    const factor = key ? this.store.getZoom(workspaceId, key) : 1;
    if (Math.abs(wc.getZoomFactor() - factor) > 0.001) wc.setZoomFactor(factor);
  }

  // ------------------------------------------------------------ downloads

  private readonly downloads = new DownloadManager({
    dir: () => process.env.APOLLO_TEST_DOWNLOADS_DIR || app.getPath('downloads'),
    ask: () => this.store.getKv('download-ask') === '1',
    onChange: () => this.push(),
  });

  // ------------------------------------------------------------ localizar na página (Ctrl+F)

  private findState: { tabId: string; text: string; active: number; matches: number } | null = null;

  private find(text: string, forward: boolean, findNext: boolean): void {
    const tab = this.activeTab();
    const wc = tab ? this.views.get(tab.id)?.webContents : undefined;
    if (!tab || !wc || wc.isDestroyed()) return;
    if (!text) { this.stopFind(); this.findState = { tabId: tab.id, text: '', active: 0, matches: 0 }; this.push(); return; }
    // Outra aba ou texto novo: começa do zero (contagem chega pelo found-in-page).
    if (this.findState?.tabId !== tab.id || this.findState.text !== text) {
      this.findState = { tabId: tab.id, text, active: 0, matches: 0 };
      findNext = false;
    }
    wc.findInPage(text, { forward, findNext, matchCase: false });
  }

  private stopFind(): void {
    const st = this.findState;
    this.findState = null;
    const wc = st ? this.views.get(st.tabId)?.webContents : undefined;
    if (wc && !wc.isDestroyed()) wc.stopFindInPage('keepSelection');
    this.push();
  }

  // ------------------------------------------------------------ favoritos (por workspace)

  /** Marca a página da aba ativa; se já for favorita, devolve a existente (não duplica). */
  private addBookmark(): Bookmark | null {
    const tab = this.activeTab();
    if (!tab || isHomeUrl(tab.url) || !/^(https?|file):/i.test(tab.url)) return null;
    const existing = this.store.findBookmark(tab.workspaceId, tab.url);
    if (existing) return existing;
    const b = this.store.addBookmark({ id: newId(), workspaceId: tab.workspaceId, title: (tab.title || tab.url).slice(0, 300),
      url: tab.url, favicon: tab.favicon });
    this.push();
    return b;
  }

  private updateBookmark(id: string, title: string, url: string, parentId?: string | null): void {
    const b = this.store.getBookmark(id);
    if (!b || b.folder) return;
    const clean = normalizeUrl(url);
    if (!clean) return;
    this.store.updateBookmark(id, { title: title.trim() || clean, url: clean });
    if (parentId !== undefined && parentId !== b.parentId) this.store.moveBookmark(id, parentId, Number.MAX_SAFE_INTEGER);
  }

  private addBookmarkFolder(title: string, parentId: string | null): void {
    this.store.addFolder({ id: newId(), workspaceId: this.activeWorkspaceId, title: title.trim().slice(0, 300), parentId });
  }

  /** Favorito: abre (na aba atual se estiver na página inicial). Pasta: abre tudo em abas. */
  private openBookmark(id: string, newTab: boolean): void {
    const b = this.store.getBookmark(id);
    if (!b) return;
    if (b.workspaceId !== this.activeWorkspaceId) this.switchWorkspace(b.workspaceId);
    if (b.folder) {
      for (const x of this.store.childBookmarks(b.workspaceId, b.id).filter((x) => !x.folder)) {
        this.createTab(b.workspaceId, x.url, { activate: false });
      }
      return;
    }
    const tab = this.activeTab();
    if (!newTab && tab && isHomeUrl(tab.url)) this.navigate(b.url);
    else this.createTab(b.workspaceId, b.url, { activate: true });
  }

  /** Itens de uma pasta como menu nativo (subpastas viram submenus). */
  private bookmarkMenuItems(folderId: string | null, from = 0): MenuItemConstructorOptions[] {
    const all = this.store.listBookmarks(this.activeWorkspaceId);
    const build = (parent: string | null, skip = 0, depth = 0): MenuItemConstructorOptions[] => {
      const kids = all.filter((b) => b.parentId === parent).slice(skip);
      const items: MenuItemConstructorOptions[] = kids.map((b) => b.folder
        ? { label: `📁 ${b.title}`, submenu: depth < 12 ? build(b.id, 0, depth + 1) : [] }
        : { label: b.title || b.url, click: this.run({ type: 'bookmark:open', bookmarkId: b.id }) });
      const links = kids.filter((b) => !b.folder).length;
      if (parent && links > 1) {
        items.push({ type: 'separator' }, { label: `Abrir todos (${links}) em abas`, click: this.run({ type: 'bookmark:open', bookmarkId: parent }) });
      }
      if (!items.length) items.push({ label: '(vazia)', enabled: false });
      return items;
    };
    return build(folderId, from);
  }

  private showBookmarkMenu(folderId: string | null, x: number, y: number, from?: number): void {
    if (folderId && this.store.getBookmark(folderId)?.workspaceId !== this.activeWorkspaceId) return;
    this.popup(this.bookmarkMenuItems(folderId, from ?? 0), x, y);
  }

  /** Botão direito num favorito/pasta da barra (ou na barra vazia). */
  private showBookmarkContext(id: string | null, x: number, y: number): void {
    const b = id ? this.store.getBookmark(id) : null;
    if (id && (!b || b.workspaceId !== this.activeWorkspaceId)) return;
    const parentForNew = b ? (b.folder ? b.id : b.parentId) : null;
    const items: MenuItemConstructorOptions[] = [];
    if (b && !b.folder) {
      items.push(
        { label: 'Abrir', click: this.run({ type: 'bookmark:open', bookmarkId: b.id }) },
        { label: 'Abrir em nova aba', click: this.run({ type: 'bookmark:open', bookmarkId: b.id, newTab: true }) },
        { type: 'separator' },
        { label: 'Editar…', click: () => { this.focusUi(); this.emit({ type: 'edit-bookmark', bookmarkId: b.id }); } },
      );
    } else if (b) {
      const links = this.store.childBookmarks(b.workspaceId, b.id).filter((x) => !x.folder).length;
      items.push(
        { label: `Abrir todos (${links}) em abas`, enabled: links > 0, click: this.run({ type: 'bookmark:open', bookmarkId: b.id }) },
        { type: 'separator' },
        { label: 'Renomear…', click: () => { this.focusUi(); this.emit({ type: 'edit-bookmark', bookmarkId: b.id }); } },
      );
    }
    const tab = this.activeTab();
    const canAdd = tab && !isHomeUrl(tab.url) && /^(https?|file):/i.test(tab.url);
    items.push(
      ...(b ? [{ type: 'separator' as const }] : []),
      { label: b?.folder ? 'Adicionar esta página aqui' : 'Adicionar esta página', enabled: Boolean(canAdd), click: () => this.addBookmarkTo(parentForNew) },
      { label: b?.folder ? 'Nova subpasta…' : 'Nova pasta…', click: () => { this.focusUi(); this.emit({ type: 'new-bookmark-folder', parentId: parentForNew }); } },
      { type: 'separator' },
      ...(b ? [{ label: b.folder ? 'Excluir a pasta (e o que tem dentro)' : 'Excluir', click: this.run({ type: 'bookmark:remove', bookmarkId: b.id }) },
        { type: 'separator' as const }] : []),
      { label: 'Gerenciar favoritos…', click: () => { this.focusUi(); this.emit({ type: 'manage-bookmarks' }); } },
      { label: 'Mostrar a barra de favoritos', type: 'checkbox', checked: this.bookmarkBarOn(), accelerator: 'CmdOrCtrl+Shift+B',
        click: this.run({ type: 'settings:bookmark-bar', show: !this.bookmarkBarOn() }) },
    );
    this.popup(items, x, y);
  }

  /** "Adicionar esta página" numa pasta (ou na barra), sem duplicar. */
  private addBookmarkTo(parentId: string | null): void {
    const b = this.addBookmark();
    if (b && b.parentId !== parentId) this.store.moveBookmark(b.id, parentId, Number.MAX_SAFE_INTEGER);
    this.push();
  }

  private bookmarkBarOn(): boolean {
    return this.store.getKv('bookmark-bar') !== '0';
  }

  // ------------------------------------------------------------ histórico (janela)

  private historyQuery: string | null = null; // null = janela fechada

  // ------------------------------------------------------------ compartilhar tela (Teams, Meet…)

  private screenRequest: {
    info: ScreenPickerInfo;
    callback: (streams: Electron.Streams | null) => void;
    requesterTabId: string | null;
    screens: Map<string, Electron.DesktopCapturerSource>;
    timer: NodeJS.Timeout;
  } | null = null;

  private static isWayland(): boolean {
    return process.platform === 'linux' && app.commandLine.getSwitchValue('ozone-platform') !== 'headless'
      && (process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY));
  }

  /** getDisplayMedia(): mostra o seletor do Apollo. A escolha do usuário é o consentimento. */
  private async handleDisplayMedia(request: Electron.DisplayMediaRequestHandlerHandlerRequest,
    callback: (streams: Electron.Streams | null) => void): Promise<void> {
    if (this.screenRequest || !request.videoRequested) { callback(null); return; } // um pedido por vez
    const requesterTabId = request.frame ? this.tabIdOfWebContentsId(this.webContentsIdOfFrame(request.frame)) : null;
    const sources: ScreenSource[] = [];
    const screens = new Map<string, Electron.DesktopCapturerSource>();
    if (Browser.isWayland()) {
      // No Wayland só o sistema (portal) pode listar telas/janelas: ele mostra o seletor dele.
      sources.push({ id: 'system', name: 'Tela ou janela (escolher no seletor do sistema)', kind: 'system', thumbnail: null });
    } else {
      // Prazo: um sistema que não responde não pode impedir o seletor de abrir.
      const list = await within(desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } }), 4000);
      if (!list) console.warn('[apollo] não foi possível listar telas/janelas (sem resposta do sistema)');
      for (const src of list ?? []) {
        screens.set(src.id, src);
        sources.push({ id: src.id, name: src.name, kind: src.id.startsWith('screen:') ? 'screen' : 'window',
          thumbnail: src.thumbnail.isEmpty() ? null : src.thumbnail.toDataURL() });
      }
    }
    for (const [tabId, view] of this.views) {
      const wc = view.webContents;
      if (tabId === requesterTabId || wc.isDestroyed()) continue;
      const tab = this.store.getTab(tabId);
      if (!tab) continue;
      const img = await within(wc.capturePage(), 1500); // aba escondida pode não ter quadro: sem miniatura
      const thumbnail = img && !img.isEmpty() ? img.resize({ width: 320 }).toDataURL() : null;
      sources.push({ id: `tab:${tabId}`, name: tab.title || tab.url, kind: 'tab', thumbnail });
    }
    const info: ScreenPickerInfo = {
      id: newId(),
      origin: originOf(request.securityOrigin) ?? request.securityOrigin,
      audioRequested: request.audioRequested,
      systemAudio: process.platform === 'win32',
      sources,
    };
    const timer = setTimeout(() => this.pickScreen(info.id, null, false), 120_000); // sem resposta: nega
    timer.unref();
    this.screenRequest = { info, callback, requesterTabId, screens, timer };
    this.push();
  }

  private webContentsIdOfFrame(frame: Electron.WebFrameMain): number | undefined {
    for (const view of this.views.values()) {
      if (!view.webContents.isDestroyed() && view.webContents.mainFrame === frame.top) return view.webContents.id;
    }
    return undefined;
  }

  /** Abas sendo compartilhadas: precisam continuar desenhando quadros mesmo fora da tela. */
  private readonly sharedTabs = new Set<string>();
  private sharedTimer: NodeJS.Timeout | null = null;

  /** Bounds fora da área visível, do tamanho normal: o Chromium desenha, ninguém vê. */
  private offscreenBounds() {
    return { x: -(this.bounds.width + 200), y: 0, width: Math.max(this.bounds.width, 640), height: Math.max(this.bounds.height, 360) };
  }

  /**
   * Página escondida não desenha quadros, e a captura ficaria esperando para sempre.
   * Enquanto a aba é compartilhada, ela fica anexada à janela, mas fora da área visível.
   */
  private keepRendering(tabId: string): void {
    const view = this.views.get(tabId);
    if (!view) return;
    this.sharedTabs.add(tabId);
    if (this.attachedTabId !== tabId) {
      this.win.contentView.addChildView(view, 0);
      view.setBounds(this.offscreenBounds());
      view.setVisible(true);
    }
    this.sharedTimer ??= setInterval(() => this.checkSharedTabs(), 3000);
  }

  /** Compartilhamento acabou: a aba volta a ficar só na memória (ou é a da tela). */
  private checkSharedTabs(): void {
    for (const tabId of [...this.sharedTabs]) {
      const view = this.views.get(tabId);
      if (view && !view.webContents.isDestroyed() && view.webContents.isBeingCaptured()) continue;
      this.sharedTabs.delete(tabId);
      if (view && this.attachedTabId !== tabId) this.win.contentView.removeChildView(view);
    }
    if (!this.sharedTabs.size && this.sharedTimer) { clearInterval(this.sharedTimer); this.sharedTimer = null; }
  }

  pickScreen(requestId: string, sourceId: string | null, audio: boolean): void {
    const req = this.screenRequest;
    if (!req || req.info.id !== requestId) return;
    clearTimeout(req.timer);
    this.screenRequest = null;
    this.push();
    const done = (streams: Electron.Streams | null) => { try { req.callback(streams); } catch { /* pedido já encerrado */ } };
    if (!sourceId) return done(null);
    if (sourceId === 'system') {
      // Wayland: o portal do sistema mostra o seletor e devolve só a escolha do usuário.
      void desktopCapturer.getSources({ types: ['screen', 'window'] })
        .then((list) => done(list[0] ? { video: list[0] } : null))
        .catch(() => done(null));
      return;
    }
    if (sourceId.startsWith('tab:')) {
      const tabId = sourceId.slice(4);
      const wc = this.views.get(tabId)?.webContents;
      if (!wc || wc.isDestroyed()) return done(null);
      this.keepRendering(tabId);
      return done({ video: wc.mainFrame, ...(audio ? { audio: wc.mainFrame } : {}) });
    }
    const src = req.screens.get(sourceId);
    if (!src) return done(null);
    done({ video: src, ...(audio && process.platform === 'win32' ? { audio: 'loopback' as const } : {}) });
  }

  // ------------------------------------------------------------ corretor ortográfico

  /** Público: o index aplica à sessão padrão (a da interface) antes de a janela carregar. */
  applySpellcheck(ses: Session): void {
    const langs = spellcheckLanguages(parseSpellcheck(this.store.getKv('spellcheck')));
    // Lista vazia também no "desligado": o Chromium guarda os idiomas nas preferências da
    // sessão e baixaria os dicionários deles mesmo com o corretor desligado.
    ses.setSpellCheckerLanguages(langs);
    ses.setSpellCheckerEnabled(langs.length > 0);
  }

  setSpellcheck(mode: SpellcheckMode): void {
    this.store.setKv('spellcheck', mode);
    this.applySpellcheck(session.defaultSession); // a interface também tem campos de texto
    for (const wsId of this.sessionsReady.keys()) {
      if (this.store.getWorkspace(wsId)) this.applySpellcheck(session.fromPartition(this.partitionOf(wsId)));
    }
  }

  // ------------------------------------------------------------ módulos e personalizações

  isModuleOn(id: ModuleId): boolean {
    this.moduleCache ??= parseModules(this.store.getKv('modules'));
    return this.moduleCache[id];
  }

  setModule(id: ModuleId, enabled: boolean): void {
    const m = { ...parseModules(this.store.getKv('modules')), [id]: enabled };
    this.store.setKv('modules', JSON.stringify(m));
    this.moduleCache = m;
  }

  /** CSS como estilo de usuário; JS num mundo isolado próprio (DOM sim; página e Apollo não). */
  private applyCustomizations(wc: WebContents): void {
    if (wc.isDestroyed() || !this.isModuleOn('customizations')) return;
    for (const c of customizationsFor(this.store.listCustomizations(), wc.mainFrame.url)) {
      if (c.css.trim()) void wc.insertCSS(c.css, { cssOrigin: 'user' }).catch(() => {});
      if (c.js.trim()) {
        void wc.executeJavaScriptInIsolatedWorld(USER_SCRIPT_WORLD, [{ code: c.js }])
          .catch((err: Error) => console.warn(`[apollo] personalização "${c.name}" falhou:`, err.message));
      }
    }
  }

  // ------------------------------------------------------------ painéis laterais

  private static mobileUA(): string {
    return `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Mobile Safari/537.36`;
  }

  addPanel(url: string, workspaceId: string, mobile: boolean): void {
    if (!this.store.getWorkspace(workspaceId)) return;
    const p = this.store.createPanel({ id: newId(), workspaceId, url, mobile });
    this.openPanel(p.id);
  }

  togglePanel(id: string): void {
    if (this.activePanelId === id) this.closePanel();
    else this.openPanel(id);
  }

  private ensurePanelView(id: string): WebContentsView | null {
    const existing = this.panelViews.get(id);
    if (existing && !existing.webContents.isDestroyed()) return existing;
    const p = this.store.getPanel(id);
    if (!p) return null;
    const view = new WebContentsView({
      webPreferences: {
        session: this.sessionFor(p.workspaceId), // logins do workspace escolhido
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: true,
        preload: path.join(__dirname, 'tab-preload.js'),
      },
    });
    view.setBackgroundColor('#ffffff');
    const wc = view.webContents;
    if (p.mobile) wc.setUserAgent(Browser.mobileUA());
    wc.on('page-title-updated', (_e, title) => { this.store.updatePanel(id, { title }); this.push(); });
    wc.on('page-favicon-updated', (_e, icons) => { this.store.updatePanel(id, { favicon: icons[0] ?? null }); this.push(); });
    wc.on('render-process-gone', () => this.destroyPanelView(id));
    wc.on('dom-ready', () => this.applyCustomizations(wc));
    wc.on('before-input-event', (event, input) => {
      const action = shortcutFor(input);
      if (!action) return;
      event.preventDefault();
      this.runShortcut(action);
    });
    wc.on('context-menu', (_e, params) => this.showPageMenu(wc, params, p.workspaceId, null));
    wc.setWindowOpenHandler(({ url, disposition }) => {
      // Link "nova aba" do painel: abre como aba no workspace do painel.
      if (disposition === 'foreground-tab' || disposition === 'background-tab' || disposition === 'new-window') {
        if (/^https?:/i.test(url)) {
          this.switchWorkspace(p.workspaceId);
          this.createTab(p.workspaceId, url, { activate: true });
        }
        return { action: 'deny' };
      }
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true,
        webPreferences: { session: this.sessionFor(p.workspaceId), sandbox: true, contextIsolation: true, nodeIntegration: false } } };
    });
    this.panelViews.set(id, view);
    void this.sessionsReady.get(p.workspaceId)?.then(() => { if (!wc.isDestroyed()) wc.loadURL(p.url).catch(() => {}); });
    return view;
  }

  openPanel(id: string): void {
    const view = this.ensurePanelView(id);
    if (!view) return;
    if (this.activePanelId && this.activePanelId !== id) {
      this.hidePanelView(this.activePanelId);
      this.panelClosedAt.set(this.activePanelId, Date.now());
    }
    this.panelClosedAt.delete(id);
    if (this.activePanelId !== id) this.win.contentView.addChildView(view);
    this.activePanelId = id;
    this.layoutPanel();
    this.push();
  }

  closePanel(): void {
    if (!this.activePanelId) return;
    const id = this.activePanelId;
    this.hidePanelView(id); // continua vivo (mensagens seguem chegando), salvo regra de hibernar
    this.activePanelId = null;
    this.panelClosedAt.set(id, Date.now());
    if (this.store.getPanel(id)?.hibernateMin === 0) this.hibernateClosedPanels(Date.now());
    this.push();
  }

  /** Hiberna (descarrega) um painel; ele continua no trilho e recarrega ao abrir. */
  hibernatePanel(id: string): void {
    if (this.activePanelId === id) this.closePanel();
    this.destroyPanelView(id);
  }

  /** Painéis fechados há mais tempo que a regra deles (nunca os que tocam áudio). */
  private hibernateClosedPanels(now: number): void {
    for (const p of this.store.listPanels()) {
      const v = this.panelViews.get(p.id);
      if (!v || p.id === this.activePanelId || p.hibernateMin === null || v.webContents.isDestroyed()) continue;
      if (v.webContents.isCurrentlyAudible()) continue;
      const closedAt = this.panelClosedAt.get(p.id) ?? now;
      if (now - closedAt >= p.hibernateMin * minuteMs()) this.destroyPanelView(p.id);
    }
  }

  private hidePanelView(id: string): void {
    const v = this.panelViews.get(id);
    if (v) this.win.contentView.removeChildView(v);
  }

  private destroyPanelView(id: string): void {
    const v = this.panelViews.get(id);
    if (!v) return;
    if (this.activePanelId === id) { this.win.contentView.removeChildView(v); this.activePanelId = null; }
    this.panelViews.delete(id);
    if (!v.webContents.isDestroyed()) v.webContents.close();
    this.push();
  }

  removePanel(id: string): void {
    this.destroyPanelView(id);
    this.store.deletePanel(id);
    this.push();
  }

  setPanel(id: string, patch: { width?: number; mobile?: boolean; hibernateMin?: number | null }): void {
    const p = this.store.getPanel(id);
    if (!p) return;
    this.store.updatePanel(id, patch);
    if (patch.mobile !== undefined && patch.mobile !== p.mobile) {
      // Trocar o user agent exige recarregar: recria a view com o novo modo.
      const wasOpen = this.activePanelId === id;
      this.destroyPanelView(id);
      if (wasOpen) this.openPanel(id);
    }
    this.push();
  }

  private layoutPanel(): void {
    const id = this.activePanelId;
    const view = id ? this.panelViews.get(id) : null;
    if (!view) return;
    view.setVisible(!this.overlayOpen && this.panelBounds.width > 0);
    view.setBounds(this.panelBounds);
  }

  showPanelMenu(id: string, x: number, y: number): void {
    const p = this.store.getPanel(id);
    if (!p) return;
    const wsName = this.store.getWorkspace(p.workspaceId)?.name ?? '';
    this.popup([
      { label: `${p.title || p.url} — sessão do workspace ${wsName}`, enabled: false },
      { type: 'separator' },
      { label: 'Recarregar', enabled: this.panelViews.has(id), click: () => this.panelViews.get(id)?.webContents.reload() },
      { label: 'Versão para celular', type: 'checkbox', checked: p.mobile, click: this.run({ type: 'panel:set', panelId: id, mobile: !p.mobile }) },
      // Largura: arrastando a borda esquerda do painel (salva por painel).
      { label: `Voltar à largura padrão (${PANEL_DEFAULT_WIDTH} px)`, enabled: p.width !== PANEL_DEFAULT_WIDTH,
        click: this.run({ type: 'panel:set', panelId: id, width: PANEL_DEFAULT_WIDTH }) },
      { type: 'separator' },
      { label: 'Hibernar agora (libera a memória)', enabled: this.panelViews.has(id), click: this.run({ type: 'panel:hibernate', panelId: id }) },
      { label: 'Hibernar quando fechado', submenu: PANEL_HIBERNATE_OPTIONS_MIN.map((m) => ({
        label: m === null ? 'Nunca (sempre ativo — mensagens chegam)' : m === 0 ? 'Ao fechar' : m < 60 ? `Após ${m} min fechado` : `Após ${m / 60} h fechado`,
        type: 'radio' as const, checked: p.hibernateMin === m,
        click: this.run({ type: 'panel:set', panelId: id, hibernateMin: m }),
      })) },
      { type: 'separator' },
      // Painel não tem a barra de permissão das abas: notificações decididas aqui.
      ...(() => {
        const origin = originOf(p.url);
        if (!origin) return [];
        const cur = this.store.getPermission(p.workspaceId, origin, 'notifications');
        const set = (decision: PermissionDecision | null) => () => {
          this.permissions.set(p.workspaceId, origin, 'notifications', decision);
          this.panelViews.get(id)?.webContents.reload(); // o site relê a permissão
        };
        return [{ label: 'Notificações', submenu: [
          { label: 'Permitir', type: 'radio' as const, checked: cur === 'allow', click: set('allow') },
          { label: 'Bloquear', type: 'radio' as const, checked: cur === 'deny', click: set('deny') },
          { label: 'Perguntar (o site pede)', type: 'radio' as const, checked: cur === null, click: set(null) },
        ] }, { type: 'separator' as const }];
      })(),
      { label: 'Remover painel', click: this.run({ type: 'panel:remove', panelId: id }) },
    ], x, y);
  }

  private panelsInfo(): PanelInfo[] {
    return this.store.listPanels().map((p) => ({ ...p, loaded: this.panelViews.has(p.id) }));
  }

  // ------------------------------------------------------------ monitor de memória

  toggleMemoryMonitor(open: boolean): void {
    if (open && !this.memoryTimer) {
      this.refreshMemory();
      this.memoryTimer = setInterval(() => this.refreshMemory(), 2000);
    } else if (!open && this.memoryTimer) {
      clearInterval(this.memoryTimer);
      this.memoryTimer = null;
      this.memoryReport = null;
    }
    this.push();
  }

  private refreshMemory(): void {
    const { usedMb, otherMb, perTab } = this.memoryInfo();
    const tabs = this.store.listWorkspaces().flatMap((ws) => this.store.listTabs(ws.id).map((t) => ({
      id: t.id,
      workspaceId: ws.id,
      title: t.title || t.url,
      favicon: t.favicon,
      mb: perTab.has(t.id) ? Math.round(perTab.get(t.id)!) : null,
      home: isHomeUrl(t.url) && !this.views.has(t.id),
      visible: t.id === this.attachedTabId,
      keepAwake: t.keepAwake,
      playing: this.playing.has(t.id) || Boolean(this.views.get(t.id)?.webContents.isCurrentlyAudible()),
    })));
    tabs.sort((a, b) => (b.mb ?? -1) - (a.mb ?? -1));
    this.memoryReport = {
      totalMb: Math.round(usedMb),
      otherMb: Math.round(otherMb),
      limitMb: Number(this.store.getKv('memoryLimitMb')) || 0,
      tabs,
    };
    this.push();
  }

  /** Mostra a aba, trocando de workspace se preciso. */
  private panelIdOf(wc: WebContents): string | null {
    for (const [id, view] of this.panelViews) if (view.webContents === wc) return id;
    return null;
  }

  /** Estado das notificações para a página que está carregando (aba ou painel). */
  notificationState(wc: WebContents, url: string): 'ask' | 'allow' | 'deny' | null {
    const origin = originOf(url);
    const tabId = this.tabIdOf(wc);
    const panelId = tabId ? null : this.panelIdOf(wc);
    const ws = tabId ? this.store.getTab(tabId)?.workspaceId : panelId ? this.store.getPanel(panelId)?.workspaceId : undefined;
    return origin && ws ? this.permissions.notificationState(ws, origin) : null;
  }

  /** Clicou numa notificação: mostra a aba (mesmo em outro workspace) ou abre o painel. */
  showFromNotification(wc: WebContents): void {
    const tabId = this.tabIdOf(wc);
    const panelId = tabId ? null : this.panelIdOf(wc);
    if (tabId) this.revealTab(tabId);
    else if (panelId && this.activePanelId !== panelId) this.openPanel(panelId);
    else if (!panelId) return;
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  revealTab(tabId: string): void {
    const tab = this.store.getTab(tabId);
    if (!tab) return;
    this.switchWorkspace(tab.workspaceId);
    this.activateTab(tabId);
  }

  private hibernationCandidates(perTab: Map<string, number>, now: number): HibernationCandidate[] {
    const out: HibernationCandidate[] = [];
    for (const [tabId, view] of this.views) {
      const tab = this.store.getTab(tabId);
      const wc = view.webContents;
      if (!tab || wc.isDestroyed()) continue;
      out.push({
        id: tabId,
        workspaceId: tab.workspaceId,
        alive: true,
        visible: tabId === this.attachedTabId,
        keepAwake: tab.keepAwake,
        playingMedia: this.playing.has(tabId) || wc.isCurrentlyAudible() || wc.isBeingCaptured(),
        unloadBlocked: this.unloadBlocked.has(tabId),
        lastSeenAt: this.lastSeen.get(tabId) ?? now,
        memoryMb: perTab.get(tabId) ?? null,
        workspaceVisible: tab.workspaceId === this.activeWorkspaceId,
      });
    }
    return out;
  }

  /** Uma rodada: decide e hiberna. Barata quando não há abas em segundo plano. */
  hibernationTick(now = Date.now()): string[] {
    if (!this.isModuleOn('hibernation')) return [];
    this.hibernateClosedPanels(now);
    if (this.views.size <= 1) return [];
    const limit = Number(this.store.getKv('memoryLimitMb')) || null;
    const { usedMb, perTab } = limit ? this.memoryInfo() : { usedMb: 0, perTab: new Map<string, number>() };
    const ids = pickTabsToHibernate(this.hibernationCandidates(perTab, now), {
      timeoutMin: (t) => {
        const ws = this.store.getWorkspace(t.workspaceId);
        return ws ? effectiveTimeout(ws.hibernateAfterMin, ws.hiddenHibernateMin, t.workspaceVisible) : null;
      },
      memoryLimitMb: limit,
      memoryUsedMb: usedMb,
    }, now, minuteMs());
    for (const id of ids) this.hibernateTab(id);
    return ids;
  }

  /** Mostra a aba ativa do workspace ativo (criando a view se preciso). */
  private showActive(): void {
    const tab = this.activeTab();
    if (this.attachedTabId && this.attachedTabId !== tab?.id) {
      const old = this.views.get(this.attachedTabId);
      if (old && this.sharedTabs.has(this.attachedTabId)) {
        this.win.contentView.addChildView(old, 0); // compartilhada: continua desenhando, fora da tela
        old.setBounds(this.offscreenBounds());
      } else if (old) {
        this.win.contentView.removeChildView(old);
      }
      this.lastSeen.set(this.attachedTabId, Date.now());
      if (this.findState?.tabId === this.attachedTabId) this.stopFind();
      if (this.pageFullscreenTabId === this.attachedTabId) {
        old?.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true).catch(() => {});
        this.pageFullscreenTabId = null;
      }
      this.attachedTabId = null;
      this.scheduleHibernation();
    }
    // Nova aba na página inicial: a interface desenha a página; nenhum processo é criado
    // até você abrir um endereço (economiza ~40 MB e deixa o Ctrl+T instantâneo).
    if (tab && isHomeUrl(tab.url) && !this.views.has(tab.id)) {
      this.focusAddress();
      this.push();
      return;
    }
    if (tab) {
      const view = this.ensureView(tab);
      if (this.attachedTabId !== tab.id) {
        this.win.contentView.addChildView(view);
        this.attachedTabId = tab.id;
        this.unloadBlocked.delete(tab.id); // o usuário viu a aba: pode tentar de novo depois
      }
      this.lastSeen.set(tab.id, Date.now());
      this.layout();
      if (isHomeUrl(tab.url)) this.focusAddress();
      else view.webContents.focus();
    }
    this.push();
  }

  private layout(): void {
    this.layoutPanel();
    if (!this.attachedTabId) return;
    const view = this.views.get(this.attachedTabId);
    if (!view) return;
    // Vídeo (ou outro elemento) em tela cheia: a página cobre a janela inteira, por cima de tudo.
    if (this.pageFullscreenTabId === this.attachedTabId) {
      const [width, height] = this.win.getContentSize();
      this.win.contentView.addChildView(view); // para o topo (acima de painéis)
      view.setVisible(true);
      view.setBounds({ x: 0, y: 0, width, height });
      return;
    }
    // A view é nativa e fica POR CIMA do HTML da UI: com um diálogo aberto, escondemos a página.
    view.setVisible(!this.overlayOpen && this.bounds.width > 0);
    view.setBounds(this.bounds);
  }

  /** Foco na interface do navegador (para a paleta/diálogos receberem o teclado). */
  private focusUi(): void {
    this.win.webContents.focus();
  }

  private focusAddress(): void {
    this.win.webContents.focus();
    this.emit({ type: 'focus-address' });
  }

  closeTab(tabId: string): void {
    const tab = this.store.getTab(tabId);
    if (!tab) return;
    const tabs = this.store.listTabs(tab.workspaceId);
    const idx = tabs.findIndex((t) => t.id === tabId);

    this.permissions.cancelForTab(tabId);
    this.destroyView(tabId); // grava o histórico antes
    this.lastSeen.delete(tabId);
    this.unloadBlocked.delete(tabId);
    this.pausedTabs.delete(tabId);
    this.blocked.delete(tabId);
    this.pendingSaves.delete(tabId);
    this.usernameSteps.delete(tabId);
    if (this.screenRequest?.requesterTabId === tabId) this.pickScreen(this.screenRequest.info.id, null, false);
    const closed = this.store.getTab(tabId)!;
    if (!isHomeUrl(closed.url)) {
      this.closedTabs.push({ workspaceId: closed.workspaceId, index: idx, url: closed.url, title: closed.title, history: closed.history, groupId: closed.groupId });
      if (this.closedTabs.length > MAX_CLOSED_TABS) this.closedTabs.shift();
    }
    this.store.deleteTab(tabId);

    const ws = this.store.getWorkspace(tab.workspaceId)!;
    if (ws.activeTabId === tabId) {
      const rest = tabs.filter((t) => t.id !== tabId);
      const next = rest[idx] ?? rest[idx - 1] ?? null;
      this.store.setActiveTab(ws.id, next?.id ?? null);
    }
    this.ensureHasTab(ws.id);
    if (ws.id === this.activeWorkspaceId) this.showActive();
    this.push();
  }

  /** Ctrl+Shift+T: reabre a última aba fechada do workspace ativo, no mesmo lugar. */
  reopenClosedTab(): void {
    const i = this.closedTabs.findLastIndex((c) => c.workspaceId === this.activeWorkspaceId);
    if (i < 0) return;
    const [closed] = this.closedTabs.splice(i, 1);
    const tab = this.store.insertTabAt(
      { id: newId(), workspaceId: closed.workspaceId, url: closed.url, title: closed.title, history: closed.history },
      closed.index,
    );
    const group = closed.groupId && this.store.getGroup(closed.groupId);
    this.reorder(tab.workspaceId, (tabs) => (group ? joinGroupInPlace(tabs, tab.id, group.id) : normalize(tabs)));
    this.store.setActiveTab(tab.workspaceId, tab.id);
    this.showActive();
  }

  activateTab(tabId: string): void {
    const tab = this.store.getTab(tabId);
    if (!tab || tab.workspaceId !== this.activeWorkspaceId) return;
    // Aba de grupo recolhido: expande o grupo para ela aparecer.
    if (tab.groupId && this.store.getGroup(tab.groupId)?.collapsed) this.store.updateGroup(tab.groupId, { collapsed: false });
    this.store.setActiveTab(tab.workspaceId, tabId);
    this.showActive();
  }

  private cycleTab(delta: number): void {
    const ws = this.activeWorkspace();
    const tabs = this.store.listTabs(ws.id);
    const idx = tabs.findIndex((t) => t.id === ws.activeTabId);
    const next = tabs[(idx + delta + tabs.length) % tabs.length];
    if (next) this.activateTab(next.id);
  }

  private withActiveView(fn: (wc: WebContents) => void): void {
    const tab = this.activeTab();
    const view = tab && this.views.get(tab.id);
    if (view && !view.webContents.isDestroyed()) fn(view.webContents);
  }

  navigate(url: string): void {
    const tab = this.activeTab();
    if (!tab) return;
    this.store.updateTab(tab.id, { url });
    const view = this.views.get(tab.id);
    if (view && this.awaitingLoad.has(tab.id)) {
      // Ainda esperando os cookies: a navegação entra no histórico que loadTab vai restaurar.
      // (Carregar agora seria desfeito pela restauração logo depois.)
      this.store.setTabHistory(tab.id, withNavigation(tab.history, url));
    } else if (view) view.webContents.loadURL(url).catch(() => {});
    else {
      // Aba sem página (dormindo, ou página inicial desenhada pela interface): a navegação
      // entra no histórico salvo e a view nasce com ele. Saindo da página inicial, ela fica
      // antes no histórico (o "voltar" leva de volta a ela, como antes).
      const base = !tab.history && isHomeUrl(tab.url) ? { index: 0, entries: [{ url: APOLLO_HOME, title: 'Nova aba' }] } : tab.history;
      this.store.setTabHistory(tab.id, withNavigation(base, url));
      this.showActive();
    }
    this.withActiveView((wc) => wc.focus());
    this.push();
  }

  // ------------------------------------------------------------ organização (ordem, fixar, grupos)

  /** Aplica uma regra de ordem (tab-order.ts) às abas do workspace e grava. */
  private reorder(workspaceId: string, fn: (tabs: OrderTab[]) => OrderTab[]): void {
    const tabs = this.store.listTabs(workspaceId).map(({ id, pinned, groupId }) => ({ id, pinned, groupId }));
    this.store.applyOrder(workspaceId, fn(tabs));
  }

  private tabInActiveWorkspace(tabId: string): Tab | null {
    const tab = this.store.getTab(tabId);
    return tab && tab.workspaceId === this.activeWorkspaceId ? tab : null;
  }

  private groupInActiveWorkspace(groupId: string) {
    const g = this.store.getGroup(groupId);
    return g && g.workspaceId === this.activeWorkspaceId ? g : null;
  }

  moveTabTo(tabId: string, index: number, groupId?: string | null): void {
    const tab = this.tabInActiveWorkspace(tabId);
    if (!tab) return;
    if (groupId && !this.groupInActiveWorkspace(groupId)) return;
    this.reorder(tab.workspaceId, (tabs) => moveTab(tabs, tabId, index, groupId));
  }

  pinTab(tabId: string, pinned: boolean): void {
    const tab = this.tabInActiveWorkspace(tabId);
    if (tab) this.reorder(tab.workspaceId, (tabs) => setPinned(tabs, tabId, pinned));
  }

  duplicateTab(tabId: string): void {
    const tab = this.tabInActiveWorkspace(tabId);
    if (!tab) return;
    if (this.views.has(tabId)) this.captureHistory(tabId);
    const fresh = this.store.getTab(tabId)!;
    const copy = this.store.insertTab({ id: newId(), workspaceId: tab.workspaceId, url: fresh.url, title: fresh.title, history: fresh.history }, tabId);
    this.reorder(tab.workspaceId, (tabs) => (fresh.groupId ? joinGroupInPlace(tabs, copy.id, fresh.groupId) : normalize(tabs)));
    this.store.setActiveTab(tab.workspaceId, copy.id);
    this.showActive();
  }

  /** Fecha outras abas (ou só as à direita). Fixadas ficam. */
  closeOtherTabs(tabId: string, onlyRight: boolean): void {
    const tab = this.tabInActiveWorkspace(tabId);
    if (!tab) return;
    const tabs = this.store.listTabs(tab.workspaceId);
    const idx = tabs.findIndex((t) => t.id === tabId);
    this.store.setActiveTab(tab.workspaceId, tabId);
    for (const t of tabs.slice(onlyRight ? idx + 1 : 0)) {
      if (t.id !== tabId && !t.pinned) this.closeTab(t.id);
    }
    this.showActive();
  }

  /** "Nova aba no grupo": pedido explícito — expande o grupo se estiver recolhido. */
  newTabInGroup(groupId: string): void {
    const g = this.groupInActiveWorkspace(groupId);
    if (!g) return;
    if (g.collapsed) this.store.updateGroup(groupId, { collapsed: false });
    const last = this.store.listTabs(g.workspaceId).filter((t) => t.groupId === groupId).pop();
    if (last) this.createTab(g.workspaceId, null, { activate: true, afterTabId: last.id });
  }

  createGroup(tabId: string): void {
    const tab = this.tabInActiveWorkspace(tabId);
    if (!tab) return;
    const used = new Set(this.store.listGroups(tab.workspaceId).map((g) => g.color));
    const color = GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[0];
    const group = this.store.createGroup({ id: newId(), workspaceId: tab.workspaceId, name: '', color });
    this.reorder(tab.workspaceId, (tabs) => setGroup(tabs, tabId, group.id));
    this.emit({ type: 'edit-group', groupId: group.id });
  }

  addToGroup(tabId: string, groupId: string | null): void {
    const tab = this.tabInActiveWorkspace(tabId);
    if (!tab || (groupId && !this.groupInActiveWorkspace(groupId))) return;
    this.reorder(tab.workspaceId, (tabs) => setGroup(tabs, tabId, groupId));
  }

  ungroup(groupId: string): void {
    const g = this.groupInActiveWorkspace(groupId);
    if (!g) return;
    this.reorder(g.workspaceId, (tabs) => tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: null } : t)));
    this.store.deleteGroup(groupId);
  }

  closeGroup(groupId: string): void {
    const g = this.groupInActiveWorkspace(groupId);
    if (!g) return;
    for (const t of this.store.listTabs(g.workspaceId)) if (t.groupId === groupId) this.closeTab(t.id);
  }

  collapseGroup(groupId: string, collapsed: boolean): void {
    const g = this.groupInActiveWorkspace(groupId);
    if (!g) return;
    this.store.updateGroup(groupId, { collapsed });
    // Recolheu o grupo da aba ativa: ativa a primeira aba visível fora dele.
    const active = this.activeTab();
    if (collapsed && active?.groupId === groupId) {
      const tabs = this.store.listTabs(g.workspaceId);
      const idx = tabs.findIndex((t) => t.id === active.id);
      const visible = (t: Tab) => t.groupId !== groupId;
      const next = tabs.slice(idx).find(visible) ?? [...tabs.slice(0, idx)].reverse().find(visible);
      if (next) this.activateTab(next.id);
      else this.createTab(g.workspaceId, null, { activate: true, afterTabId: tabs[tabs.length - 1].id });
    }
  }

  // ------------------------------------------------------------ menus de contexto (nativos: ficam acima da página)

  /** Último menu nativo montado (os testes acionam os itens por aqui). */
  lastMenu: MenuItemConstructorOptions[] | null = null;

  private popup(items: MenuItemConstructorOptions[], x: number, y: number): void {
    this.lastMenu = items;
    if (process.env.APOLLO_TEST_HOOKS) return; // testes: o menu nativo bloquearia a automação
    Menu.buildFromTemplate(items).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
  }

  // ------------------------------------------------------------ menu de contexto das páginas

  /** Último menu montado (para testes: os itens e quem clicou). */
  lastPageMenu: { items: ContextItem[]; run: (label: string) => boolean } | null = null;

  private showPageMenu(wc: Electron.WebContents, params: Electron.ContextMenuParams, workspaceId: string, tabId: string | null): void {
    const items = buildContextMenu(params as unknown as ContextInfo, {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      vaultUnlocked: this.vaultInfo.status === 'unlocked' && tabId !== null,
    });
    const act = (a: ContextAction) => this.runPageAction(wc, params, workspaceId, tabId, a);
    this.lastPageMenu = {
      items,
      run: (label) => {
        const it = items.find((x) => x.type === 'item' && x.label === label);
        if (!it || it.type !== 'item' || it.enabled === false) return false;
        act(it.action);
        return true;
      },
    };
    if (process.env.APOLLO_TEST_HOOKS) return; // testes: o menu nativo bloquearia a automação
    Menu.buildFromTemplate(items.map((it) => it.type === 'separator'
      ? { type: 'separator' as const }
      : { label: it.label, enabled: it.enabled !== false, click: () => act(it.action) })).popup({ window: this.win });
  }

  private runPageAction(wc: Electron.WebContents, params: Electron.ContextMenuParams, workspaceId: string,
    tabId: string | null, a: ContextAction): void {
    if (wc.isDestroyed()) return;
    const newTab = (url: string, activate: boolean) => {
      if (!this.store.getWorkspace(workspaceId)) return;
      this.createTab(workspaceId, url, { activate, afterTabId: tabId });
    };
    switch (a.kind) {
      case 'open-link': newTab(a.url, !a.background); break;
      case 'search': newTab(a.url, true); break;
      case 'copy-text': clipboard.writeText(a.text); break;
      case 'copy-image': wc.copyImageAt(params.x, params.y); break;
      case 'save-url': this.downloads.saveAs(wc, a.url); break;
      case 'replace-misspelling': wc.replaceMisspelling(a.word); break;
      case 'add-to-dictionary': wc.session.addWordToSpellCheckerDictionary(a.word); break;
      case 'edit': wc[a.op](); break;
      case 'nav':
        if (a.op === 'reload') wc.reload();
        else if (a.op === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        else if (a.op === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
        break;
      case 'view-source': newTab(`view-source:${wc.getURL()}`, true); break;
      case 'print': this.print(wc); break;
      case 'inspect': wc.inspectElement(params.x, params.y); break;
      case 'vault': if (a.op === 'autofill') this.autofill(); else this.generate(true); break;
    }
  }

  private run(cmd: UiCommand): () => void {
    return () => this.handleCommand(cmd);
  }

  showTabMenu(tabId: string, x: number, y: number): void {
    const tab = this.tabInActiveWorkspace(tabId);
    if (!tab) return;
    const groups = this.store.listGroups(tab.workspaceId).filter((g) => g.id !== tab.groupId);
    const tabs = this.store.listTabs(tab.workspaceId);
    const isLast = tabs[tabs.length - 1]?.id === tabId;
    this.popup([
      { label: 'Nova aba à direita', click: () => { this.createTab(tab.workspaceId, null, { activate: true, afterTabId: tabId }); } },
      { type: 'separator' },
      { label: 'Recarregar', click: () => { this.views.get(tabId)?.webContents.reload(); } },
      { label: 'Duplicar', click: this.run({ type: 'tab:duplicate', tabId }) },
      { label: tab.pinned ? 'Desafixar' : 'Fixar', click: this.run({ type: 'tab:pin', tabId, pinned: !tab.pinned }) },
      { label: 'Manter sempre ativa (não hibernar)', type: 'checkbox', checked: tab.keepAwake,
        click: this.run({ type: 'tab:keep-awake', tabId, keepAwake: !tab.keepAwake }) },
      { label: 'Hibernar agora', enabled: this.views.has(tabId) && tabId !== this.attachedTabId,
        click: this.run({ type: 'tab:hibernate', tabId }) },
      { label: 'Hibernar outras abas', click: this.run({ type: 'tab:hibernate-others', tabId }) },
      { type: 'separator' },
      { label: 'Adicionar a um novo grupo', click: this.run({ type: 'group:create', tabId }) },
      ...(groups.length ? [{ label: 'Mover para o grupo', submenu: groups.map((g) => ({
        label: g.name || 'Grupo sem nome', click: this.run({ type: 'group:add', tabId, groupId: g.id }),
      })) }] : []),
      ...(tab.groupId ? [{ label: 'Remover do grupo', click: this.run({ type: 'group:add', tabId, groupId: null }) }] : []),
      { type: 'separator' },
      { label: 'Fechar', accelerator: 'CmdOrCtrl+W', click: this.run({ type: 'tab:close', tabId }) },
      { label: 'Fechar outras abas', enabled: tabs.length > 1, click: this.run({ type: 'tab:close-others', tabId }) },
      { label: 'Fechar abas à direita', enabled: !isLast, click: this.run({ type: 'tab:close-right', tabId }) },
      { type: 'separator' },
      { label: 'Reabrir aba fechada', accelerator: 'CmdOrCtrl+Shift+T',
        enabled: this.closedTabs.some((c) => c.workspaceId === tab.workspaceId), click: this.run({ type: 'tab:reopen' }) },
    ], x, y);
  }

  showGroupMenu(groupId: string, x: number, y: number): void {
    const g = this.groupInActiveWorkspace(groupId);
    if (!g) return;
    this.popup([
      { label: 'Renomear / mudar cor…', click: () => this.emit({ type: 'edit-group', groupId }) },
      { label: g.collapsed ? 'Expandir' : 'Recolher', click: this.run({ type: 'group:collapse', groupId, collapsed: !g.collapsed }) },
      { label: 'Nova aba no grupo', click: () => {
        this.handleCommand({ type: 'group:new-tab', groupId });
      } },
      { type: 'separator' },
      { label: 'Desagrupar', click: this.run({ type: 'group:ungroup', groupId }) },
      { label: 'Fechar grupo', click: this.run({ type: 'group:close', groupId }) },
    ], x, y);
  }

  // ------------------------------------------------------------ workspaces

  switchWorkspace(workspaceId: string): void {
    if (!this.store.getWorkspace(workspaceId) || workspaceId === this.activeWorkspaceId) return;
    this.scheduleHibernation();
    this.activeWorkspaceId = workspaceId;
    this.store.setKv('activeWorkspaceId', workspaceId);
    this.ensureHasTab(workspaceId);
    this.showActive();
  }

  createWorkspace(name: string, color: string, home: string, hibernateAfterMin?: number, temporary?: boolean, hiddenHibernateMin?: number | null): void {
    const ws = this.store.createWorkspace({ id: newId(), name, color, home: home || APOLLO_HOME, hibernateAfterMin, hiddenHibernateMin, temporary });
    this.ensureHasTab(ws.id);
    this.switchWorkspace(ws.id);
  }

  updateWorkspace(workspaceId: string, name: string, color: string, home: string, hibernateAfterMin?: number, hiddenHibernateMin?: number | null): void {
    this.store.updateWorkspace(workspaceId, { name, color, home: home || APOLLO_HOME, hibernateAfterMin, hiddenHibernateMin });
    this.push();
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const all = this.store.listWorkspaces();
    if (all.length <= 1 || !all.some((w) => w.id === workspaceId)) return;

    for (const tab of this.store.listTabs(workspaceId)) {
      this.permissions.cancelForTab(tab.id);
      this.destroyView(tab.id);
    }
    this.closedTabs = this.closedTabs.filter((c) => c.workspaceId !== workspaceId);
    if (workspaceId === this.activeWorkspaceId) {
      this.switchWorkspace(all.find((w) => w.id !== workspaceId)!.id);
    }
    for (const p of this.store.listPanels()) if (p.workspaceId === workspaceId) this.destroyPanelView(p.id);
    // A partição depende do workspace (temporário ou não): calcular ANTES de apagá-lo.
    const partition = this.partitionOf(workspaceId);
    this.store.deleteWorkspace(workspaceId); // abas, grupos e permissões vão junto (cascade)
    this.sessionsReady.delete(workspaceId);

    // Apaga logins, cookies, cache e storage do workspace.
    const ses = session.fromPartition(partition);
    await ses.clearStorageData();
    await ses.clearCache();
    this.push();
  }

  // ------------------------------------------------------------ atalhos e comandos

  runShortcut(action: ShortcutAction): void {
    switch (action) {
      case 'new-tab': this.createTab(this.activeWorkspaceId, null, { activate: true }); break;
      case 'reopen-tab': this.reopenClosedTab(); break;
      case 'close-tab': { const t = this.activeTab(); if (t) this.closeTab(t.id); break; }
      case 'focus-address': this.focusAddress(); break;
      case 'reload': this.withActiveView((wc) => wc.reload()); break;
      case 'back': this.withActiveView((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()); break;
      case 'forward': this.withActiveView((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()); break;
      case 'next-tab': this.cycleTab(1); break;
      case 'prev-tab': this.cycleTab(-1); break;
      case 'memory-monitor': this.toggleMemoryMonitor(!this.memoryTimer); break;
      case 'autofill': this.autofill(); break;
      case 'palette': this.focusUi(); this.emit({ type: 'open-palette' }); break;
      case 'find': this.focusUi(); this.emit({ type: 'open-find' }); break;
      case 'bookmark-bar': this.store.setKv('bookmark-bar', this.bookmarkBarOn() ? '0' : '1'); this.push(); break;
      case 'history': this.focusUi(); this.emit({ type: 'open-history' }); break;
      case 'zoom-in': this.zoomActive('in'); break;
      case 'print': this.withActiveWc((wc) => this.print(wc)); break;
      case 'fullscreen': this.toggleFullscreen(); break;
      case 'devtools': this.withActiveWc((wc) => this.toggleDevTools(wc)); break;
      case 'zoom-out': this.zoomActive('out'); break;
      case 'zoom-reset': this.zoomActive('reset'); break;
      case 'find-next':
      case 'find-prev':
        if (this.findState?.text) this.find(this.findState.text, action === 'find-next', true);
        else { this.focusUi(); this.emit({ type: 'open-find' }); }
        break;
      case 'bookmark': {
        const b = this.addBookmark();
        if (b) { this.focusUi(); this.emit({ type: 'edit-bookmark', bookmarkId: b.id }); }
        break;
      }
      default: {
        const ws = this.store.listWorkspaces()[Number(action.split('-')[1]) - 1];
        if (ws) this.switchWorkspace(ws.id);
      }
    }
  }

  handleCommand(cmd: UiCommand): void {
    switch (cmd.type) {
      case 'tab:new': this.createTab(this.activeWorkspaceId, cmd.url ?? null, { activate: true }); break;
      case 'tab:reopen': this.reopenClosedTab(); break;
      case 'tab:close': this.closeTab(cmd.tabId); break;
      case 'tab:activate': this.activateTab(cmd.tabId); break;
      case 'tab:navigate': this.navigate(cmd.url); break;
      case 'tab:back': this.runShortcut('back'); break;
      case 'tab:forward': this.runShortcut('forward'); break;
      case 'tab:reload': this.runShortcut('reload'); break;
      case 'tab:focus': this.withActiveView((wc) => wc.focus()); break;
      case 'tab:move': this.moveTabTo(cmd.tabId, cmd.index, cmd.groupId); break;
      case 'tab:pin': this.pinTab(cmd.tabId, cmd.pinned); break;
      case 'tab:keep-awake': if (this.tabInActiveWorkspace(cmd.tabId)) this.store.setKeepAwake(cmd.tabId, cmd.keepAwake); break;
      case 'tab:duplicate': this.duplicateTab(cmd.tabId); break;
      // O monitor de memória lista abas de todos os workspaces.
      case 'tab:hibernate': if (this.store.getTab(cmd.tabId)) this.hibernateTab(cmd.tabId, true); break;
      case 'tab:reveal': this.revealTab(cmd.tabId); break;
      case 'memory:toggle': this.toggleMemoryMonitor(cmd.open); break;
      case 'privacy:set': this.setPrivacy(cmd.scope, cmd.feature, cmd.enabled, cmd.workspaceId); break;
      case 'privacy:pause-tab': this.pauseTab(cmd.paused); break;
      case 'privacy:reset-site': this.resetSitePrivacy(); break;
      case 'privacy:menu': this.showPrivacyMenu(cmd.x, cmd.y); break;
      case 'vault:menu': this.showVaultMenu(cmd.x, cmd.y); break;
      case 'vault:fill': this.fillLogin(cmd.itemId); break;
      case 'vault:copy': this.copyFromVault(cmd.itemId, cmd.what); break;
      case 'vault:open': this.emit({ type: 'open-vault' }); break;
      case 'vault:autofill': this.autofill(); break;
      case 'palette:toggle': this.paletteOpen = cmd.open; if (!cmd.open) this.paletteQuery = ''; break;
      case 'palette:query': this.paletteQuery = cmd.text; break;
      case 'settings:history': this.store.setKv('history-off', cmd.on ? '0' : '1'); break;
      case 'history:clear': this.store.clearHistory(); break;
      case 'panel:add': this.addPanel(cmd.url, cmd.workspaceId, cmd.mobile); break;
      case 'panel:toggle': this.togglePanel(cmd.panelId); break;
      case 'panel:remove': this.removePanel(cmd.panelId); break;
      case 'panel:set': this.setPanel(cmd.panelId, { width: cmd.width, mobile: cmd.mobile, hibernateMin: cmd.hibernateMin }); break;
      case 'panel:hibernate': this.hibernatePanel(cmd.panelId); break;
      case 'panel:bounds': this.panelBounds = { x: cmd.x, y: cmd.y, width: cmd.width, height: cmd.height }; this.layoutPanel(); break;
      case 'panel:menu': this.showPanelMenu(cmd.panelId, cmd.x, cmd.y); break;
      case 'module:set': this.setModule(cmd.moduleId, cmd.enabled); break;
      case 'settings:spellcheck': this.setSpellcheck(cmd.mode); break;
      case 'screen:pick': this.pickScreen(cmd.requestId, cmd.sourceId, cmd.audio); break;
      case 'zoom:set': this.zoomActive(cmd.dir); break;
      case 'view:fullscreen': this.toggleFullscreen(); break;
      case 'tab:print': this.withActiveWc((wc) => this.print(wc)); break;
      case 'tab:devtools': this.withActiveWc((wc) => this.toggleDevTools(wc)); break;
      case 'download:action': this.downloads.action(cmd.downloadId, cmd.action); break;
      case 'download:clear': this.downloads.clear(); break;
      case 'settings:download-ask': this.store.setKv('download-ask', cmd.ask ? '1' : '0'); break;
      case 'find:query': this.find(cmd.text, cmd.forward, cmd.findNext); break;
      case 'find:close': this.stopFind(); break;
      case 'bookmark:add': this.addBookmark(); break;
      case 'bookmark:update': this.updateBookmark(cmd.bookmarkId, cmd.title, cmd.url, cmd.parentId); break;
      case 'bookmark:rename': this.store.renameBookmark(cmd.bookmarkId, cmd.title.trim()); break;
      case 'bookmark:add-folder': this.addBookmarkFolder(cmd.title, cmd.parentId); break;
      case 'bookmark:remove': this.store.removeBookmark(cmd.bookmarkId); break;
      case 'bookmark:move': this.store.moveBookmark(cmd.bookmarkId, cmd.parentId, cmd.index); break;
      case 'bookmark:menu': this.showBookmarkMenu(cmd.folderId, cmd.x, cmd.y, cmd.from); break;
      case 'bookmark:context': this.showBookmarkContext(cmd.bookmarkId, cmd.x, cmd.y); break;
      case 'settings:bookmark-bar': this.store.setKv('bookmark-bar', cmd.show ? '1' : '0'); break;
      case 'history:view': this.historyQuery = cmd.open ? cmd.query : null; break;
      case 'history:delete': this.store.deleteVisit(this.activeWorkspaceId, cmd.url); break;
      case 'bookmark:open': this.openBookmark(cmd.bookmarkId, cmd.newTab ?? false); break;
      case 'custom:save':
        this.store.saveCustomization({ id: cmd.id ?? newId(), name: cmd.name.trim(), sites: cmd.sites.trim(), css: cmd.css, js: cmd.js, enabled: cmd.enabled });
        break;
      case 'custom:delete': this.store.deleteCustomization(cmd.id); break;
      case 'vault:save-answer': this.answerSave(cmd.promptId, cmd.action); break;
      case 'vault:generate': this.generate(cmd.fill); break;
      case 'vault:generator': this.store.setKv('vault.generator', JSON.stringify({ length: cmd.length, symbols: cmd.symbols })); break;
      case 'permission:menu': this.showPermissionsMenu(cmd.x, cmd.y); break;
      case 'settings:memory-limit':
        this.store.setKv('memoryLimitMb', String(cmd.mb));
        if (this.memoryReport) this.memoryReport = { ...this.memoryReport, limitMb: cmd.mb };
        break;
      case 'tab:hibernate-others':
        for (const t of this.store.listTabs(this.activeWorkspaceId)) if (t.id !== cmd.tabId) this.hibernateTab(t.id, true);
        break;
      case 'tab:close-others': this.closeOtherTabs(cmd.tabId, false); break;
      case 'tab:close-right': this.closeOtherTabs(cmd.tabId, true); break;
      case 'tab:menu': this.showTabMenu(cmd.tabId, cmd.x, cmd.y); break;
      case 'group:create': this.createGroup(cmd.tabId); break;
      case 'group:add': this.addToGroup(cmd.tabId, cmd.groupId); break;
      case 'group:update':
        if (this.groupInActiveWorkspace(cmd.groupId)) this.store.updateGroup(cmd.groupId, { name: cmd.name.trim(), color: cmd.color });
        break;
      case 'group:collapse': this.collapseGroup(cmd.groupId, cmd.collapsed); break;
      case 'group:ungroup': this.ungroup(cmd.groupId); break;
      case 'group:close': this.closeGroup(cmd.groupId); break;
      case 'group:menu': this.showGroupMenu(cmd.groupId, cmd.x, cmd.y); break;
      case 'group:new-tab': this.newTabInGroup(cmd.groupId); break;
      case 'workspace:switch': this.switchWorkspace(cmd.workspaceId); break;
      case 'workspace:create': this.createWorkspace(cmd.name, cmd.color, cmd.home, cmd.hibernateAfterMin, cmd.temporary, cmd.hiddenHibernateMin); break;
      case 'workspace:update': this.updateWorkspace(cmd.workspaceId, cmd.name, cmd.color, cmd.home, cmd.hibernateAfterMin, cmd.hiddenHibernateMin); break;
      case 'workspace:delete': void this.deleteWorkspace(cmd.workspaceId); break;
      case 'layout:bounds': this.bounds = { x: cmd.x, y: cmd.y, width: cmd.width, height: cmd.height }; this.layout(); break;
      case 'layout:overlay': this.overlayOpen = cmd.open; this.layout(); break;
      case 'permission:answer': this.permissions.answer(cmd.promptId, cmd.decision, cmd.remember); break;
      case 'permission:set': this.permissions.set(this.activeWorkspaceId, cmd.origin, cmd.kind, cmd.decision); break;
      case 'update:download':
      case 'update:install':
        break; // tratados pelo updater (index.ts)
    }
    this.push(); // a UI sempre recebe o estado resultante
  }

  // ------------------------------------------------------------ estado para a UI

  private vaultInfo: VaultStatusInfo = {
    status: 'disconnected', email: null, server: null, count: 0, lastSync: null, lockAfterMin: 15, busy: false, error: null, canRemember: false,
  };

  private paletteOpen = false;
  private paletteQuery = '';

  private historyOn(workspaceId: string): boolean {
    return this.store.getKv('history-off') !== '1' && !this.store.getWorkspace(workspaceId)?.temporary;
  }

  private visit(workspaceId: string, url: string, title: string): void {
    if (/^https?:/i.test(url) && this.historyOn(workspaceId)) this.store.recordVisit(workspaceId, url, title);
  }
  private moduleCache: Record<ModuleId, boolean> | null = null;

  // Painéis laterais
  private readonly panelViews = new Map<string, WebContentsView>();
  private activePanelId: string | null = null;
  /** Quando cada painel foi fechado (para hibernar depois de N min fechado). */
  private readonly panelClosedAt = new Map<string, number>();
  private panelBounds = { x: 0, y: 0, width: 0, height: 0 };
  private vaultProvider: VaultProvider | null = null;
  private clipboardTimer: NodeJS.Timeout | null = null;
  /** Logins enviados aguardando "salvar?" (senha só aqui, em memória, por 5 min). */
  private readonly pendingSaves = new Map<string, PendingSave>();
  /** E-mail da 1ª etapa de logins em duas etapas, por aba. */
  private readonly usernameSteps = new Map<string, { site: string | null; username: string; at: number }>();

  /** Preload da aba: o usuário digitou o usuário numa 1ª etapa (sem senha). */
  onUsernameStep(tabId: string, frameUrl: string, username: string): void {
    this.usernameSteps.set(tabId, { site: siteOf(frameUrl), username, at: Date.now() });
  }

  /** Preload da aba: login enviado. A URL é a do frame (dada pelo main), nunca a da página. */
  onLoginSubmitted(tabId: string, frameUrl: string, username: string | null, password: string): void {
    const status = this.vaultProvider?.status() ?? 'disconnected';
    const site = siteOf(frameUrl);
    if (!this.isModuleOn('vaultSave') || status === 'disconnected' || !site || !/^https?:/.test(frameUrl) || this.neverSaveSites().has(site)) return;
    let user = username;
    const step = this.usernameSteps.get(tabId);
    if (!user && step && step.site === site && Date.now() - step.at < SAVE_PROMPT_TTL_MS) user = step.username;
    const pending: PendingSave = { id: newId(), url: frameUrl, username: user, password, at: Date.now(), decision: undefined };
    if (!this.decide(pending)) return; // já salvo exatamente assim
    this.pendingSaves.set(tabId, pending);
    this.push();
  }

  /** Decide (se o cofre está aberto). false = não há o que oferecer. */
  private decide(p: PendingSave): boolean {
    const v = this.vaultProvider?.vault();
    if (!v) return true; // bloqueado: pergunta depois de desbloquear
    if (p.decision === undefined) p.decision = decideSave(v.logins, (id) => v.password(id), p.url, p.username, p.password);
    return p.decision !== null;
  }

  private neverSaveSites(): Set<string> {
    try { return new Set(JSON.parse(this.store.getKv('vault.neverSave') ?? '[]') as string[]); } catch { return new Set(); }
  }

  private savePrompt(tabId: string | null): UiState['savePrompt'] {
    const p = tabId ? this.pendingSaves.get(tabId) : undefined;
    if (!p || !tabId) return null;
    if (Date.now() - p.at > SAVE_PROMPT_TTL_MS || (this.vaultProvider?.status() ?? 'disconnected') === 'disconnected') {
      this.pendingSaves.delete(tabId);
      return null;
    }
    if (!this.decide(p)) { this.pendingSaves.delete(tabId); return null; }
    const mode = p.decision === undefined ? 'locked' : p.decision!.mode;
    return { id: p.id, site: siteOf(p.url) ?? p.url, username: p.username, mode };
  }

  answerSave(promptId: string, action: 'save' | 'dismiss' | 'never'): void {
    const entry = [...this.pendingSaves].find(([, p]) => p.id === promptId);
    if (!entry) return;
    const [tabId, p] = entry;
    if (action === 'never') {
      const sites = this.neverSaveSites();
      const site = siteOf(p.url);
      if (site) sites.add(site);
      this.store.setKv('vault.neverSave', JSON.stringify([...sites]));
    }
    if (action === 'save') {
      if (!this.decide(p) || p.decision === undefined) return; // ainda bloqueado: barra continua
      const d = p.decision!;
      if (d.mode === 'save') {
        void this.vaultProvider!.saveLogin({ name: itemName(p.url), username: p.username, password: p.password, uri: new URL(p.url).origin });
      } else {
        void this.vaultProvider!.updatePassword(d.itemId, p.password);
      }
    }
    this.pendingSaves.delete(tabId);
    this.push();
  }

  private generatorOptions(): { length: number; symbols: boolean } {
    try {
      const g = JSON.parse(this.store.getKv('vault.generator') ?? 'null') as { length: number; symbols: boolean } | null;
      if (g && typeof g.length === 'number' && typeof g.symbols === 'boolean') return g;
    } catch { /* padrão */ }
    return { length: DEFAULT_GENERATOR.length, symbols: DEFAULT_GENERATOR.symbols };
  }

  /** Gera uma senha: preenche os campos de senha novos da página ou copia. */
  generate(fill: boolean): void {
    const password = generatePassword({ ...DEFAULT_GENERATOR, ...this.generatorOptions() });
    const tab = this.activeTab();
    const wc = tab && this.views.get(tab.id)?.webContents;
    if (fill && wc && !wc.isDestroyed() && /^https?:/.test(wc.mainFrame.url)) {
      wc.mainFrame.send('apollo:fill-new-password', password);
    }
    this.copySecret(password); // também na área de transferência (some em 30 s), para não perder a senha
  }

  private copySecret(value: string): void {
    void clipboard.writeText(value);
    if (this.clipboardTimer) clearTimeout(this.clipboardTimer);
    this.clipboardTimer = setTimeout(() => {
      void Promise.resolve(clipboard.readText()).then((now) => { if (now === value) clipboard.clear(); });
    }, CLIPBOARD_CLEAR_MS);
    this.clipboardTimer.unref();
  }

  setVaultProvider(p: VaultProvider): void {
    this.vaultProvider = p;
  }

  /** URL atual REAL do frame principal (não a salva: a página pode ter navegado). */
  private liveUrl(): string | null {
    const tab = this.activeTab();
    const wc = tab && this.views.get(tab.id)?.webContents;
    return wc && !wc.isDestroyed() ? wc.mainFrame.url : null;
  }

  private vaultSite(url: string | null | undefined): UiState['vaultSite'] {
    const status = this.vaultProvider?.status() ?? 'disconnected';
    if (status === 'disconnected' || !url || !/^https?:/.test(url)) return null;
    const v = this.vaultProvider!.vault();
    return { status: status as 'locked' | 'unlocked', count: v ? loginsFor(v.logins, url).length : 0 };
  }

  showVaultMenu(x: number, y: number): void {
    const url = this.liveUrl() ?? this.activeTab()?.url ?? '';
    const v = this.vaultProvider?.vault();
    const site = siteOf(url) ?? url;
    this.popup(this.toTemplate(vaultMenu(this.vaultProvider?.status() ?? 'disconnected', v ? loginsFor(v.logins, url) : [], site)), x, y);
  }

  /** Preenche só se a página ATUAL ainda casa com o login (e só no frame principal). */
  fillLogin(itemId: string): void {
    const v = this.vaultProvider?.vault();
    const tab = this.activeTab();
    const wc = tab && this.views.get(tab.id)?.webContents;
    if (!v || !wc || wc.isDestroyed()) return;
    const url = wc.mainFrame.url;
    const login = v.logins.find((l) => l.id === itemId);
    if (!login || !login.uris.some((u) => uriMatches(u, url))) return;
    wc.mainFrame.send('apollo:fill', { username: login.username, password: v.password(itemId) });
  }

  /** Ctrl+Shift+L: preenche o primeiro login do site; cofre bloqueado → abre o diálogo. */
  autofill(): void {
    const status = this.vaultProvider?.status() ?? 'disconnected';
    if (status !== 'unlocked') { this.emit({ type: 'open-vault' }); return; }
    const url = this.liveUrl();
    const first = url ? loginsFor(this.vaultProvider!.vault()!.logins, url)[0] : undefined;
    if (first) this.fillLogin(first.id);
  }

  /** Copia e apaga da área de transferência em 30 s (se ainda for o mesmo conteúdo). */
  copyFromVault(itemId: string, what: 'username' | 'password' | 'totp'): void {
    const v = this.vaultProvider?.vault();
    const login = v?.logins.find((l) => l.id === itemId);
    if (!v || !login) return;
    let value: string | null = null;
    if (what === 'username') value = login.username;
    else if (what === 'password') value = v.password(itemId);
    else {
      const secret = v.totpSecret(itemId);
      try { value = secret ? totp(parseTotp(secret)).code : null; } catch { value = null; }
    }
    if (!value) return;
    if (what === 'username') { void clipboard.writeText(value); return; } // usuário não é segredo
    this.copySecret(value);
  }

  setVault(info: VaultStatusInfo): void {
    this.vaultInfo = info;
    this.push();
  }

  setSettings(patch: Partial<Omit<SettingsInfo, 'privacy' | 'spellcheck' | 'downloadAsk' | 'historyOn' | 'bookmarkBar'>>): void {
    this.settings = { ...this.settings, ...patch };
    this.push();
  }

  setUpdate(status: UpdateStatus | null): void {
    this.update = status;
    this.push();
  }

  /** Primeira exibição, depois que a UI carregou. */
  start(): void {
    this.showActive();
    if (!this.hibernationTimer) {
      this.hibernationTimer = setInterval(() => this.hibernationTick(), hibernationTickMs());
      this.hibernationTimer.unref();
    }
  }

  private emit(event: UiEvent): void {
    if (!this.win.isDestroyed()) this.win.webContents.send('ui:event', event);
  }

  push(): void {
    if (this.pushScheduled) return;
    this.pushScheduled = true;
    queueMicrotask(() => {
      this.pushScheduled = false;
      if (!this.win.isDestroyed()) this.win.webContents.send('ui:state', this.snapshot());
    });
  }

  snapshot(): UiState {
    const ws = this.activeWorkspace();
    const tabs: TabInfo[] = this.store.listTabs(ws.id).map((t) => {
      const wc = this.views.get(t.id)?.webContents;
      const alive = wc && !wc.isDestroyed();
      return {
        id: t.id,
        title: t.title,
        url: t.url,
        favicon: t.favicon,
        loading: this.loading.has(t.id),
        canGoBack: alive ? wc.navigationHistory.canGoBack() : false,
        canGoForward: alive ? wc.navigationHistory.canGoForward() : false,
        dormant: !alive && !isHomeUrl(t.url),
        live: Boolean(alive),
        pinned: t.pinned,
        keepAwake: t.keepAwake,
        groupId: t.groupId,
      };
    });
    const active = this.activeTab();
    return {
      workspaces: this.store.listWorkspaces().map(({ id, name, color, home, hibernateAfterMin }) => {
        const w = this.store.getPrivacyLayers(id, null).workspace;
        const full = this.store.getWorkspace(id)!;
        return { id, name, color, home, hibernateAfterMin, hiddenHibernateMin: full.hiddenHibernateMin, privacy: nullable(w), temporary: full.temporary };
      }),
      activeWorkspaceId: ws.id,
      tabs,
      groups: this.store.listGroups(ws.id).map(({ id, name, color, collapsed }) => ({ id, name, color, collapsed })),
      activeTabId: ws.activeTabId,
      permissionPrompt: this.permissions.promptFor(ws.activeTabId),
      sitePermissions: this.permissions.siteInfo(ws.id, active?.url ?? null),
      sitePrivacy: this.sitePrivacy(active),
      update: this.update,
      memory: this.memoryReport,
      vault: this.vaultInfo,
      vaultSite: this.vaultSite(active?.url),
      savePrompt: this.savePrompt(ws.activeTabId),
      generator: this.generatorOptions(),
      paletteTabs: this.paletteOpen
        ? this.store.listWorkspaces().flatMap((w) => this.store.listTabs(w.id).map((t) => ({ id: t.id, title: t.title, url: t.url, workspaceId: w.id })))
        : null,
      paletteHistory: this.paletteOpen && this.paletteQuery.trim()
        ? this.store.searchHistory(ws.id, this.paletteQuery).map(({ url, title }) => ({ url, title }))
        : null,
      settings: { ...this.settings, privacy: nullable(this.store.getPrivacyLayers(ws.id, null).global),
        spellcheck: parseSpellcheck(this.store.getKv('spellcheck')), downloadAsk: this.store.getKv('download-ask') === '1',
        historyOn: this.store.getKv('history-off') !== '1', bookmarkBar: this.bookmarkBarOn() },
      panels: this.panelsInfo(),
      activePanelId: this.activePanelId,
      modules: MODULES.map((m) => ({ ...m, enabled: this.isModuleOn(m.id) })),
      customizations: this.store.listCustomizations(),
      screenPicker: this.screenRequest?.info ?? null,
      bookmarks: this.store.listBookmarks(ws.id).map(({ id, title, url, favicon, parentId, folder }) => ({ id, title, url, favicon, parentId, folder })),
      historyView: this.historyQuery === null ? null : {
        query: this.historyQuery,
        entries: this.store.recentHistory(ws.id, this.historyQuery).map(({ url, title, lastVisit }) => ({ url, title, lastVisit })),
      },
      fullscreen: this.pageFullscreenTabId && this.pageFullscreenTabId === ws.activeTabId ? 'page'
        : this.windowFullscreen ? 'window' : null,
      zoom: (() => {
        const wc = active ? this.views.get(active.id)?.webContents : undefined;
        return wc && !wc.isDestroyed() ? zoomPercent(wc.getZoomFactor()) : 100;
      })(),
      downloads: this.downloads.list(),
      find: this.findState && this.findState.tabId === ws.activeTabId
        ? { text: this.findState.text, active: this.findState.active, matches: this.findState.matches } : null,
      activeBookmarkId: active && !isHomeUrl(active.url) ? this.store.findBookmark(ws.id, active.url)?.id ?? null : null,
    };
  }
}
