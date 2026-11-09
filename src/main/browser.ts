import { BrowserWindow, WebContentsView, session, type Session, type WebContents, type Input } from 'electron';
import type { Store, Tab, Workspace } from './store';
import { newId } from './store';
import type { NetworkPipeline } from './network';
import { PermissionManager } from './permissions';
import type { TabInfo, UiCommand, UiEvent, UiState, UpdateStatus } from '../shared/types';
import { APOLLO_HOME, isHomeUrl } from '../shared/types';

const partitionOf = (workspaceId: string) => `persist:ws-${workspaceId}`;

type ShortcutAction =
  | 'new-tab' | 'close-tab' | 'focus-address' | 'reload' | 'back' | 'forward'
  | 'next-tab' | 'prev-tab' | `workspace-${number}`;

export function shortcutFor(input: Input): ShortcutAction | null {
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
  if (mod && /^[1-9]$/.test(input.key)) return `workspace-${Number(input.key)}`;
  return null;
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
  private readonly configuredSessions = new Set<string>();
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
  ) {
    this.permissions = new PermissionManager(store, (wc) => this.tabIdOf(wc), () => this.push());

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

  sessionFor(workspaceId: string): Session {
    const partition = partitionOf(workspaceId);
    const ses = session.fromPartition(partition);
    if (!this.configuredSessions.has(partition)) {
      this.configuredSessions.add(partition);
      this.permissions.attach(ses, workspaceId);
      this.pipeline.attach(ses, workspaceId);
    }
    return ses;
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
    const tab = this.store.insertTab(
      { id: newId(), workspaceId, url: url || ws.home || APOLLO_HOME, title: 'Nova aba' },
      opts.afterTabId ?? ws.activeTabId,
    );
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
      },
    });
    view.setBackgroundColor('#ffffff');
    const wc = view.webContents;
    this.views.set(tab.id, view);
    this.tabByWebContents.set(wc.id, tab.id);
    this.wireTab(tab.id, tab.workspaceId, wc);
    wc.loadURL(tab.url).catch(() => {}); // erros tratados em did-fail-load
    return view;
  }

  private wireTab(tabId: string, workspaceId: string, wc: WebContents): void {
    const update = (patch: Parameters<Store['updateTab']>[1]) => {
      this.store.updateTab(tabId, patch);
      this.push();
    };

    wc.on('page-title-updated', (_e, title) => update({ title }));
    wc.on('page-favicon-updated', (_e, favicons) => update({ favicon: favicons[0] ?? null }));
    wc.on('did-navigate', (_e, url) => {
      if (!url.startsWith('apollo://error')) update({ url });
      this.permissions.cancelForTab(tabId);
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) update({ url }); });
    wc.on('did-start-loading', () => { this.loading.add(tabId); this.push(); });
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

  private destroyView(tabId: string): void {
    const view = this.views.get(tabId);
    if (!view) return;
    if (this.attachedTabId === tabId) {
      this.win.contentView.removeChildView(view);
      this.attachedTabId = null;
    }
    this.tabByWebContents.delete(view.webContents.id);
    this.views.delete(tabId);
    this.loading.delete(tabId);
    // WebContentsView não libera a página sozinho: fechar explicitamente devolve a RAM.
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  /** Mostra a aba ativa do workspace ativo (criando a view se preciso). */
  private showActive(): void {
    const tab = this.activeTab();
    if (this.attachedTabId && this.attachedTabId !== tab?.id) {
      const old = this.views.get(this.attachedTabId);
      if (old) this.win.contentView.removeChildView(old);
      this.attachedTabId = null;
    }
    if (tab) {
      const view = this.ensureView(tab);
      if (this.attachedTabId !== tab.id) {
        this.win.contentView.addChildView(view);
        this.attachedTabId = tab.id;
      }
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
    this.destroyView(tabId);
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

  activateTab(tabId: string): void {
    const tab = this.store.getTab(tabId);
    if (!tab || tab.workspaceId !== this.activeWorkspaceId) return;
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
    if (view) view.webContents.loadURL(url).catch(() => {});
    else this.showActive(); // cria a view já com a nova URL
    this.withActiveView((wc) => wc.focus());
    this.push();
  }

  // ------------------------------------------------------------ workspaces

  switchWorkspace(workspaceId: string): void {
    if (!this.store.getWorkspace(workspaceId) || workspaceId === this.activeWorkspaceId) return;
    this.activeWorkspaceId = workspaceId;
    this.store.setKv('activeWorkspaceId', workspaceId);
    this.ensureHasTab(workspaceId);
    this.showActive();
  }

  createWorkspace(name: string, color: string, home: string): void {
    const ws = this.store.createWorkspace({ id: newId(), name, color, home: home || APOLLO_HOME });
    this.ensureHasTab(ws.id);
    this.switchWorkspace(ws.id);
  }

  updateWorkspace(workspaceId: string, name: string, color: string, home: string): void {
    this.store.updateWorkspace(workspaceId, { name, color, home: home || APOLLO_HOME });
    this.push();
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const all = this.store.listWorkspaces();
    if (all.length <= 1 || !all.some((w) => w.id === workspaceId)) return;

    for (const tab of this.store.listTabs(workspaceId)) {
      this.permissions.cancelForTab(tab.id);
      this.destroyView(tab.id);
    }
    if (workspaceId === this.activeWorkspaceId) {
      this.switchWorkspace(all.find((w) => w.id !== workspaceId)!.id);
    }
    this.store.deleteWorkspace(workspaceId); // abas, grupos e permissões vão junto (cascade)

    // Apaga logins, cookies, cache e storage do workspace.
    const ses = session.fromPartition(partitionOf(workspaceId));
    await ses.clearStorageData();
    await ses.clearCache();
    this.push();
  }

  // ------------------------------------------------------------ atalhos e comandos

  runShortcut(action: ShortcutAction): void {
    switch (action) {
      case 'new-tab': this.createTab(this.activeWorkspaceId, null, { activate: true }); break;
      case 'close-tab': { const t = this.activeTab(); if (t) this.closeTab(t.id); break; }
      case 'focus-address': this.focusAddress(); break;
      case 'reload': this.withActiveView((wc) => wc.reload()); break;
      case 'back': this.withActiveView((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()); break;
      case 'forward': this.withActiveView((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()); break;
      case 'next-tab': this.cycleTab(1); break;
      case 'prev-tab': this.cycleTab(-1); break;
      default: {
        const ws = this.store.listWorkspaces()[Number(action.split('-')[1]) - 1];
        if (ws) this.switchWorkspace(ws.id);
      }
    }
  }

  handleCommand(cmd: UiCommand): void {
    switch (cmd.type) {
      case 'tab:new': this.createTab(this.activeWorkspaceId, cmd.url ?? null, { activate: true }); break;
      case 'tab:close': this.closeTab(cmd.tabId); break;
      case 'tab:activate': this.activateTab(cmd.tabId); break;
      case 'tab:navigate': this.navigate(cmd.url); break;
      case 'tab:back': this.runShortcut('back'); break;
      case 'tab:forward': this.runShortcut('forward'); break;
      case 'tab:reload': this.runShortcut('reload'); break;
      case 'tab:focus': this.withActiveView((wc) => wc.focus()); break;
      case 'workspace:switch': this.switchWorkspace(cmd.workspaceId); break;
      case 'workspace:create': this.createWorkspace(cmd.name, cmd.color, cmd.home); break;
      case 'workspace:update': this.updateWorkspace(cmd.workspaceId, cmd.name, cmd.color, cmd.home); break;
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

  setUpdate(status: UpdateStatus | null): void {
    this.update = status;
    this.push();
  }

  /** Primeira exibição, depois que a UI carregou. */
  start(): void {
    this.showActive();
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
      };
    });
    const active = this.activeTab();
    return {
      workspaces: this.store.listWorkspaces().map(({ id, name, color, home }) => ({ id, name, color, home })),
      activeWorkspaceId: ws.id,
      tabs,
      activeTabId: ws.activeTabId,
      permissionPrompt: this.permissions.promptFor(ws.activeTabId),
      sitePermissions: this.permissions.siteInfo(ws.id, active?.url ?? null),
      update: this.update,
    };
  }
}
