import type { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PermissionDecision, PermissionKind, PrivacyFeature } from '../shared/types';
import type { Overrides } from './privacy/rules';
import { parseHistory, sanitizeHistory, type TabHistory } from './history';
import type { OrderTab } from './tab-order';
import type { Customization } from './customizations';

export interface Workspace {
  id: string;
  name: string;
  color: string;
  home: string;
  hibernateAfterMin: number;
  hiddenHibernateMin: number | null;
  /** Sessão só em memória; o workspace some ao fechar o Apollo. */
  temporary: boolean;
  activeTabId: string | null;
}

export interface Tab {
  id: string;
  workspaceId: string;
  groupId: string | null;
  position: number;
  url: string;
  title: string;
  favicon: string | null;
  pinned: boolean;
  keepAwake: boolean;
  history: TabHistory | null;
}

export interface TabGroup {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  collapsed: boolean;
}

export type NewTab = Pick<Tab, 'id' | 'workspaceId' | 'url' | 'title'> & { history?: TabHistory | null };

export const newId = (): string => randomUUID().replaceAll('-', '').slice(0, 12);

type Row = Record<string, unknown>;

const toWorkspace = (r: Row): Workspace => ({
  id: r.id as string,
  name: r.name as string,
  color: r.color as string,
  home: r.home as string,
  hibernateAfterMin: (r.hibernate_after_min as number | undefined) ?? 30,
  hiddenHibernateMin: r.hidden_hibernate_min === undefined ? 10 : (r.hidden_hibernate_min as number | null),
  temporary: r.temporary === 1,
  activeTabId: (r.active_tab_id as string | null) ?? null,
});

const toTab = (r: Row): Tab => ({
  id: r.id as string,
  workspaceId: r.workspace_id as string,
  groupId: (r.group_id as string | null) ?? null,
  position: r.position as number,
  url: r.url as string,
  title: r.title as string,
  favicon: (r.favicon as string | null) ?? null,
  pinned: r.pinned === 1,
  keepAwake: r.keep_awake === 1,
  history: parseHistory(r.history as string | null),
});

const toGroup = (r: Row): TabGroup => ({
  id: r.id as string,
  workspaceId: r.workspace_id as string,
  name: r.name as string,
  color: r.color as string,
  collapsed: r.collapsed === 1,
});

export interface Panel {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  favicon: string | null;
  width: number;
  mobile: boolean;
  hibernateMin: number | null;
}

const toPanel = (r: Row): Panel => ({
  id: r.id as string,
  workspaceId: r.workspace_id as string,
  url: r.url as string,
  title: r.title as string,
  favicon: (r.favicon as string | null) ?? null,
  width: r.width as number,
  mobile: r.mobile === 1,
  hibernateMin: (r.hibernate_min as number | null | undefined) ?? null,
});

/** Patch sem os campos undefined (senão { ...atual, ...patch } apagaria valores salvos). */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Repositório de workspaces, abas e permissões. Toda escrita é síncrona e imediata. */
export class Store {
  constructor(private readonly db: DatabaseSync) {}

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ------------------------------------------------------------ kv

  getKv(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as Row | undefined;
    return (row?.value as string | undefined) ?? null;
  }

  setKv(key: string, value: string): void {
    this.db.prepare('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  // ------------------------------------------------------------ workspaces

  listWorkspaces(): Workspace[] {
    return (this.db.prepare('SELECT * FROM workspaces ORDER BY position').all() as Row[]).map(toWorkspace);
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Row | undefined;
    return row ? toWorkspace(row) : null;
  }

  createWorkspace(ws: Omit<Workspace, 'activeTabId' | 'hibernateAfterMin' | 'hiddenHibernateMin' | 'temporary'> & { hibernateAfterMin?: number; hiddenHibernateMin?: number | null; temporary?: boolean }): Workspace {
    const { next } = this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM workspaces').get() as { next: number };
    const hibernateAfterMin = ws.hibernateAfterMin ?? 30;
    const temporary = ws.temporary ?? false;
    const hiddenHibernateMin = ws.hiddenHibernateMin === undefined ? 10 : ws.hiddenHibernateMin;
    this.db.prepare('INSERT INTO workspaces(id, name, color, home, position, created_at, hibernate_after_min, hidden_hibernate_min, temporary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ws.id, ws.name, ws.color, ws.home, next, Date.now(), hibernateAfterMin, hiddenHibernateMin, temporary ? 1 : 0);
    return { ...ws, hibernateAfterMin, hiddenHibernateMin, temporary, activeTabId: null };
  }

  /** Apaga os workspaces temporários (ao abrir e ao fechar). Devolve os ids apagados. */
  deleteTemporaryWorkspaces(): string[] {
    const ids = (this.db.prepare('SELECT id FROM workspaces WHERE temporary = 1').all() as Row[]).map((r) => r.id as string);
    for (const id of ids) this.deleteWorkspace(id);
    return ids;
  }

  updateWorkspace(id: string, patch: Pick<Workspace, 'name' | 'color' | 'home'> & { hibernateAfterMin?: number; hiddenHibernateMin?: number | null }): void {
    this.db.prepare('UPDATE workspaces SET name = ?, color = ?, home = ?, hibernate_after_min = COALESCE(?, hibernate_after_min) WHERE id = ?')
      .run(patch.name, patch.color, patch.home, patch.hibernateAfterMin ?? null, id);
    // null é um valor válido ("mesma regra"): só não mexe quando ausente.
    if (patch.hiddenHibernateMin !== undefined) {
      this.db.prepare('UPDATE workspaces SET hidden_hibernate_min = ? WHERE id = ?').run(patch.hiddenHibernateMin, id);
    }
  }

  deleteWorkspace(id: string): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM privacy_rules WHERE workspace_id = ?').run(id);
    });
  }

  setActiveTab(workspaceId: string, tabId: string | null): void {
    this.db.prepare('UPDATE workspaces SET active_tab_id = ? WHERE id = ?').run(tabId, workspaceId);
    if (tabId) this.db.prepare('UPDATE tabs SET last_active_at = ? WHERE id = ?').run(Date.now(), tabId);
  }

  // ------------------------------------------------------------ abas

  listTabs(workspaceId: string): Tab[] {
    return (this.db.prepare('SELECT * FROM tabs WHERE workspace_id = ? ORDER BY position').all(workspaceId) as Row[]).map(toTab);
  }

  getTab(id: string): Tab | null {
    const row = this.db.prepare('SELECT * FROM tabs WHERE id = ?').get(id) as Row | undefined;
    return row ? toTab(row) : null;
  }

  /** Insere logo depois de `afterTabId` (ou no fim). */
  insertTab(tab: NewTab, afterTabId: string | null): Tab {
    const after = afterTabId ? this.getTab(afterTabId) : null;
    return this.tx(() => this.insertAtPosition(tab, after && after.workspaceId === tab.workspaceId ? after.position + 1 : null));
  }

  /** Insere no índice `index` entre as abas visíveis (0 = primeira); null ou além do fim = no fim. */
  insertTabAt(tab: NewTab, index: number | null): Tab {
    return this.tx(() => {
      // Posições têm buracos depois de excluir abas: o índice vira a posição da aba que está lá.
      const at = index === null ? undefined : this.db.prepare(
        'SELECT position FROM tabs WHERE workspace_id = ? ORDER BY position LIMIT 1 OFFSET ?',
      ).get(tab.workspaceId, Math.max(0, index)) as { position: number } | undefined;
      return this.insertAtPosition(tab, at?.position ?? null);
    });
  }

  private insertAtPosition(tab: NewTab, position: number | null): Tab {
    if (position === null) {
      position = (this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM tabs WHERE workspace_id = ?')
        .get(tab.workspaceId) as { next: number }).next;
    } else {
      this.db.prepare('UPDATE tabs SET position = position + 1 WHERE workspace_id = ? AND position >= ?')
        .run(tab.workspaceId, position);
    }
    const history = sanitizeHistory(tab.history);
    this.db.prepare('INSERT INTO tabs(id, workspace_id, position, url, title, history) VALUES (?, ?, ?, ?, ?, ?)')
      .run(tab.id, tab.workspaceId, position, tab.url, tab.title, history ? JSON.stringify(history) : null);
    return this.getTab(tab.id)!;
  }

  /** Índice da aba entre as do workspace (0 = primeira). */
  tabIndex(id: string): number {
    const tab = this.getTab(id);
    if (!tab) return -1;
    return (this.db.prepare('SELECT COUNT(*) AS n FROM tabs WHERE workspace_id = ? AND position < ?')
      .get(tab.workspaceId, tab.position) as { n: number }).n;
  }

  setKeepAwake(id: string, keepAwake: boolean): void {
    this.db.prepare('UPDATE tabs SET keep_awake = ? WHERE id = ?').run(keepAwake ? 1 : 0, id);
  }

  /** Grava ordem, fixação e grupo de todas as abas de um workspace (ver tab-order.ts). */
  applyOrder(workspaceId: string, tabs: OrderTab[]): void {
    this.tx(() => {
      const stmt = this.db.prepare('UPDATE tabs SET position = ?, pinned = ?, group_id = ? WHERE id = ? AND workspace_id = ?');
      tabs.forEach((t, i) => stmt.run(i, t.pinned ? 1 : 0, t.groupId, t.id, workspaceId));
      this.deleteEmptyGroups(workspaceId);
    });
  }

  // ------------------------------------------------------------ grupos de abas

  listGroups(workspaceId: string): TabGroup[] {
    return (this.db.prepare('SELECT * FROM tab_groups WHERE workspace_id = ? ORDER BY position').all(workspaceId) as Row[]).map(toGroup);
  }

  getGroup(id: string): TabGroup | null {
    const row = this.db.prepare('SELECT * FROM tab_groups WHERE id = ?').get(id) as Row | undefined;
    return row ? toGroup(row) : null;
  }

  createGroup(group: Omit<TabGroup, 'collapsed'>): TabGroup {
    const { next } = this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM tab_groups WHERE workspace_id = ?')
      .get(group.workspaceId) as { next: number };
    this.db.prepare('INSERT INTO tab_groups(id, workspace_id, name, color, collapsed, position) VALUES (?, ?, ?, ?, 0, ?)')
      .run(group.id, group.workspaceId, group.name, group.color, next);
    return { ...group, collapsed: false };
  }

  updateGroup(id: string, patch: Partial<Pick<TabGroup, 'name' | 'color' | 'collapsed'>>): void {
    const g = this.getGroup(id);
    if (!g) return;
    const next = { ...g, ...defined(patch) };
    this.db.prepare('UPDATE tab_groups SET name = ?, color = ?, collapsed = ? WHERE id = ?')
      .run(next.name, next.color, next.collapsed ? 1 : 0, id);
  }

  /** Remove o grupo; as abas continuam, sem grupo. */
  deleteGroup(id: string): void {
    this.db.prepare('DELETE FROM tab_groups WHERE id = ?').run(id);
  }

  deleteEmptyGroups(workspaceId: string): void {
    this.db.prepare(`DELETE FROM tab_groups WHERE workspace_id = ?
      AND id NOT IN (SELECT group_id FROM tabs WHERE group_id IS NOT NULL)`).run(workspaceId);
  }

  setTabHistory(id: string, history: TabHistory | null): void {
    const clean = sanitizeHistory(history);
    this.db.prepare('UPDATE tabs SET history = ? WHERE id = ?').run(clean ? JSON.stringify(clean) : null, id);
  }

  updateTab(id: string, patch: Partial<Pick<Tab, 'url' | 'title' | 'favicon'>>): void {
    const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (fields.length === 0) return;
    const sql = `UPDATE tabs SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...fields.map(([, v]) => v as string | null), id);
  }

  deleteTab(id: string): void {
    const tab = this.getTab(id);
    this.db.prepare('DELETE FROM tabs WHERE id = ?').run(id);
    if (tab?.groupId) this.deleteEmptyGroups(tab.workspaceId);
  }

  // ------------------------------------------------------------ permissões

  getPermission(workspaceId: string, origin: string, kind: PermissionKind): PermissionDecision | null {
    const row = this.db.prepare('SELECT decision FROM site_permissions WHERE workspace_id = ? AND origin = ? AND kind = ?')
      .get(workspaceId, origin, kind) as Row | undefined;
    return (row?.decision as PermissionDecision | undefined) ?? null;
  }

  setPermission(workspaceId: string, origin: string, kind: PermissionKind, decision: PermissionDecision | null): void {
    if (decision === null) {
      this.db.prepare('DELETE FROM site_permissions WHERE workspace_id = ? AND origin = ? AND kind = ?')
        .run(workspaceId, origin, kind);
      return;
    }
    this.db.prepare(`INSERT INTO site_permissions(workspace_id, origin, kind, decision, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, origin, kind) DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at`)
      .run(workspaceId, origin, kind, decision, Date.now());
  }

  // ------------------------------------------------------------ personalizações (CSS/JS por site)

  listCustomizations(): Customization[] {
    return (this.db.prepare('SELECT * FROM customizations ORDER BY position').all() as Row[]).map((r) => ({
      id: r.id as string, name: r.name as string, sites: r.sites as string, css: r.css as string, js: r.js as string, enabled: r.enabled === 1,
    }));
  }

  saveCustomization(c: Customization): void {
    const exists = this.db.prepare('SELECT 1 FROM customizations WHERE id = ?').get(c.id);
    if (exists) {
      this.db.prepare('UPDATE customizations SET name = ?, sites = ?, css = ?, js = ?, enabled = ? WHERE id = ?')
        .run(c.name, c.sites, c.css, c.js, c.enabled ? 1 : 0, c.id);
    } else {
      const { next } = this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM customizations').get() as { next: number };
      this.db.prepare('INSERT INTO customizations(id, name, sites, css, js, enabled, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(c.id, c.name, c.sites, c.css, c.js, c.enabled ? 1 : 0, next);
    }
  }

  deleteCustomization(id: string): void {
    this.db.prepare('DELETE FROM customizations WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------ painéis laterais

  listPanels(): Panel[] {
    return (this.db.prepare('SELECT * FROM panels ORDER BY position').all() as Row[]).map(toPanel);
  }

  getPanel(id: string): Panel | null {
    const row = this.db.prepare('SELECT * FROM panels WHERE id = ?').get(id) as Row | undefined;
    return row ? toPanel(row) : null;
  }

  createPanel(p: Pick<Panel, 'id' | 'workspaceId' | 'url' | 'mobile'>): Panel {
    const { next } = this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM panels').get() as { next: number };
    this.db.prepare('INSERT INTO panels(id, workspace_id, url, mobile, position) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, p.workspaceId, p.url, p.mobile ? 1 : 0, next);
    return this.getPanel(p.id)!;
  }

  updatePanel(id: string, patch: Partial<Pick<Panel, 'url' | 'title' | 'favicon' | 'width' | 'mobile' | 'hibernateMin'>>): void {
    const cur = this.getPanel(id);
    if (!cur) return;
    const n = { ...cur, ...defined(patch) };
    this.db.prepare('UPDATE panels SET url = ?, title = ?, favicon = ?, width = ?, mobile = ?, hibernate_min = ? WHERE id = ?')
      .run(n.url, n.title, n.favicon, n.width, n.mobile ? 1 : 0, n.hibernateMin, id);
  }

  deletePanel(id: string): void {
    this.db.prepare('DELETE FROM panels WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------ cofre (Bitwarden)

  /** Persistência do VaultService: conta em claro (sem segredos) e segredos já cifrados. */
  vaultStorage() {
    return {
      getAccount: () => this.getKv('vault.account'),
      setAccount: (json: string | null) => this.setOrDeleteKv('vault.account', json),
      getSecret: (name: 'clientSecret' | 'sync') => {
        const v = this.getKv(`vault.${name}`);
        return v ? Buffer.from(v, 'base64') : null;
      },
      setSecret: (name: 'clientSecret' | 'sync', data: Buffer | null) => this.setOrDeleteKv(`vault.${name}`, data ? data.toString('base64') : null),
    };
  }

  private setOrDeleteKv(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
    else this.setKv(key, value);
  }

  // ------------------------------------------------------------ privacidade

  private privacyRules(workspaceId: string, site: string): Overrides {
    const rows = this.db.prepare('SELECT feature, enabled FROM privacy_rules WHERE workspace_id = ? AND site = ?')
      .all(workspaceId, site) as Row[];
    return Object.fromEntries(rows.map((r) => [r.feature, r.enabled === 1]));
  }

  /** Camadas salvas (a da aba fica em memória, no Browser). */
  getPrivacyLayers(workspaceId: string, site: string | null): { global: Overrides; workspace: Overrides; site: Overrides } {
    return {
      global: this.privacyRules('', ''),
      workspace: this.privacyRules(workspaceId, ''),
      site: site ? this.privacyRules(workspaceId, site) : {},
    };
  }

  /** workspaceId null = global; site null = workspace inteiro; enabled null = remove a regra. */
  setPrivacyRule(workspaceId: string | null, site: string | null, feature: PrivacyFeature, enabled: boolean | null): void {
    if (site && !workspaceId) throw new Error('regra de site precisa de workspace');
    const key = [workspaceId ?? '', site ?? '', feature];
    if (enabled === null) {
      this.db.prepare('DELETE FROM privacy_rules WHERE workspace_id = ? AND site = ? AND feature = ?').run(...key);
      return;
    }
    this.db.prepare(`INSERT INTO privacy_rules(workspace_id, site, feature, enabled) VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id, site, feature) DO UPDATE SET enabled = excluded.enabled`).run(...key, enabled ? 1 : 0);
  }

  // ------------------------------------------------------------ cookies de sessão

  saveSessionCookies(workspaceId: string, data: Buffer): void {
    this.db.prepare(`INSERT INTO session_cookies(workspace_id, data, saved_at) VALUES (?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at`)
      .run(workspaceId, data, Date.now());
  }

  loadSessionCookies(workspaceId: string): Buffer | null {
    const row = this.db.prepare('SELECT data FROM session_cookies WHERE workspace_id = ?').get(workspaceId) as Row | undefined;
    return row ? Buffer.from(row.data as Uint8Array) : null;
  }

  // ------------------------------------------------------------ migração do protótipo

  /**
   * Importa o state.json da v0.1.0. Mantém os IDs dos workspaces, porque a partição
   * de sessão (persist:ws-<id>) depende deles — é isso que preserva os logins.
   */
  importLegacyState(file: string): boolean {
    if (!fs.existsSync(file) || this.listWorkspaces().length > 0) return false;
    let legacy: {
      activeWorkspaceId?: string;
      workspaces?: { id: string; name: string; color: string; home?: string; activeTabId?: string;
        tabs?: { id: string; url?: string; title?: string; favicon?: string }[] }[];
    };
    try {
      legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      // Arquivo corrompido: começa do zero, mas mantém o arquivo para recuperação manual.
      console.warn('[apollo] state.json ilegível, ignorado:', (err as Error).message);
      return false;
    }
    if (!Array.isArray(legacy?.workspaces) || legacy.workspaces.length === 0) return false;

    this.tx(() => {
      legacy.workspaces!.forEach((w, wi) => {
        this.db.prepare('INSERT INTO workspaces(id, name, color, home, position, active_tab_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(w.id, w.name, w.color, w.home || 'apollo://home', wi, w.activeTabId ?? null, Date.now());
        (w.tabs ?? []).forEach((t, ti) => {
          this.db.prepare('INSERT INTO tabs(id, workspace_id, position, url, title, favicon) VALUES (?, ?, ?, ?, ?, ?)')
            .run(t.id, w.id, ti, t.url || w.home || 'apollo://home', t.title ?? '', t.favicon ?? null);
        });
      });
      if (legacy.activeWorkspaceId) this.setKv('activeWorkspaceId', legacy.activeWorkspaceId);
    });
    fs.renameSync(file, `${file}.migrated`); // mantém um backup
    return true;
  }
}
