import path from 'node:path';
import { app, BrowserWindow, Menu, WebContentsView, session, type MenuItemConstructorOptions, type Session, type WebContents } from 'electron';
import type { Store, Tab, Workspace } from './store';
import { withNavigation, type TabHistory } from './history';
import { pickTabsToHibernate, type HibernationCandidate } from './hibernation';
import { memoryBreakdown } from './memory';
import { ALL_OFF, DEFAULT_TOGGLES, resolve as resolvePrivacy, siteOf, type Overrides, type Resolved } from './privacy/rules';
import type { BlockKind } from './privacy/blocker';
import type { RequestContext } from './network';
import { joinGroupInPlace, moveTab, normalize, setGroup, setPinned, type OrderTab } from './tab-order';
import { captureSessionCookies, restoreSessionCookies, type Cipher } from './session-cookies';
import { newId } from './store';
import type { NetworkPipeline } from './network';
import { PermissionManager } from './permissions';
import { shortcutFor, type ShortcutAction } from './shortcuts';
import type { MemoryReport, PrivacyFeature, SettingsInfo, SitePrivacy, TabInfo, UiCommand, UiEvent, UiState, UpdateStatus } from '../shared/types';
import { GROUP_COLORS } from '../shared/types';
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
  private settings: Omit<SettingsInfo, 'privacy'> = {
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

    if (store.listWorkspaces().length === 0) {
      store.createWorkspace({ id: newId(), name: 'Principal', color: '#7c5cff', home: APOLLO_HOME });
    }
    const saved = store.getKv('activeWorkspaceId');
    this.activeWorkspaceId = (saved && store.getWorkspace(saved)) ? saved : store.listWorkspaces()[0].id;
    this.ensureHasTab(this.activeWorkspaceId);

    win.on('resize', () => this.layout());
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

    wc.on('page-title-updated', (_e, title) => update({ title }));
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons[0] ?? null }));
    wc.on('did-navigate', (_e, url) => {
      if (!url.startsWith('apollo://error')) update({ url });
      this.blocked.delete(tabId); // contador é por página
      this.unloadBlocked.delete(tabId);
      this.permissions.cancelForTab(tabId);
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) update({ url }); });
    wc.on('did-start-loading', () => { this.loading.add(tabId); this.push(); });
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
        playingMedia: this.playing.has(tabId) || wc.isCurrentlyAudible(),
        unloadBlocked: this.unloadBlocked.has(tabId),
        lastSeenAt: this.lastSeen.get(tabId) ?? now,
        memoryMb: perTab.get(tabId) ?? null,
      });
    }
    return out;
  }

  /** Uma rodada: decide e hiberna. Barata quando não há abas em segundo plano. */
  hibernationTick(now = Date.now()): string[] {
    if (this.views.size <= 1) return [];
    const limit = Number(this.store.getKv('memoryLimitMb')) || null;
    const { usedMb, perTab } = limit ? this.memoryInfo() : { usedMb: 0, perTab: new Map<string, number>() };
    const ids = pickTabsToHibernate(this.hibernationCandidates(perTab, now), {
      timeoutMin: (wsId) => this.store.getWorkspace(wsId)?.hibernateAfterMin ?? 0,
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
      if (old) this.win.contentView.removeChildView(old);
      this.lastSeen.set(this.attachedTabId, Date.now());
      this.attachedTabId = null;
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
    if (!this.attachedTabId) return;
    const view = this.views.get(this.attachedTabId);
    if (!view) return;
    // A view é nativa e fica POR CIMA do HTML da UI: com um diálogo aberto, escondemos a página.
    view.setVisible(!this.overlayOpen && this.bounds.width > 0);
    view.setBounds(this.bounds);
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
      // Aba dormindo: a navegação entra no histórico salvo, e a view nasce com ele.
      this.store.setTabHistory(tab.id, withNavigation(tab.history, url));
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

  private popup(items: MenuItemConstructorOptions[], x: number, y: number): void {
    Menu.buildFromTemplate(items).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
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
    this.activeWorkspaceId = workspaceId;
    this.store.setKv('activeWorkspaceId', workspaceId);
    this.ensureHasTab(workspaceId);
    this.showActive();
  }

  createWorkspace(name: string, color: string, home: string, hibernateAfterMin?: number, temporary?: boolean): void {
    const ws = this.store.createWorkspace({ id: newId(), name, color, home: home || APOLLO_HOME, hibernateAfterMin, temporary });
    this.ensureHasTab(ws.id);
    this.switchWorkspace(ws.id);
  }

  updateWorkspace(workspaceId: string, name: string, color: string, home: string, hibernateAfterMin?: number): void {
    this.store.updateWorkspace(workspaceId, { name, color, home: home || APOLLO_HOME, hibernateAfterMin });
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
      case 'workspace:create': this.createWorkspace(cmd.name, cmd.color, cmd.home, cmd.hibernateAfterMin, cmd.temporary); break;
      case 'workspace:update': this.updateWorkspace(cmd.workspaceId, cmd.name, cmd.color, cmd.home, cmd.hibernateAfterMin); break;
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

  setSettings(patch: Partial<Omit<SettingsInfo, 'privacy'>>): void {
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
        dormant: !alive,
        pinned: t.pinned,
        keepAwake: t.keepAwake,
        groupId: t.groupId,
      };
    });
    const active = this.activeTab();
    return {
      workspaces: this.store.listWorkspaces().map(({ id, name, color, home, hibernateAfterMin }) => {
        const w = this.store.getPrivacyLayers(id, null).workspace;
        return { id, name, color, home, hibernateAfterMin, privacy: nullable(w), temporary: this.store.getWorkspace(id)!.temporary };
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
      settings: { ...this.settings, privacy: nullable(this.store.getPrivacyLayers(ws.id, null).global) },
    };
  }
}
