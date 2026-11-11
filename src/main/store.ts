import { fold } from '../shared/text';
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
  /** Ícone na barra lateral (emoji); null = primeira letra do nome. */
  icon: string | null;
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
  icon: (r.icon as string | null | undefined) ?? null,
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

export interface SavedDownload {
  id: string;
  filename: string;
  url: string;
  path: string;
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted';
  received: number;
  total: number;
  startedAt: number;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
}

/** Texto de busca: título e endereço (sem esquema e decodificado) sem acentos. */
export function historySearchText(url: string, title: string): string {
  let u = url.replace(/^https?:\/\/(www\.)?/i, '');
  try { u = decodeURI(u); } catch { /* malformada: como está */ }
  return fold(`${title} ${u}`);
}

/** Árvore a importar (ver import/bookmarks.ts). */
export interface ImportTreeNode { title: string; url?: string; children?: ImportTreeNode[] }

export interface Bookmark {
  id: string;
  workspaceId: string;
  title: string;
  /** '' nas pastas. */
  url: string;
  favicon: string | null;
  /** Pasta onde está (null = na barra de favoritos). */
  parentId: string | null;
  folder: boolean;
}

const toBookmark = (r: Row): Bookmark => ({
  id: r.id as string, workspaceId: r.workspace_id as string, title: r.title as string, url: r.url as string,
  favicon: (r.favicon as string | null) ?? null, parentId: (r.parent_id as string | null) ?? null, folder: r.is_folder === 1,
});

/** Mesma página para fins de favorito: sem #fragmento e sem a barra final do caminho. */
export function normalizeBookmarkUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.toString();
  } catch {
    return url;
  }
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

  deleteKv(key: string): void {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
  }

  // ------------------------------------------------------------ workspaces

  listWorkspaces(): Workspace[] {
    return (this.db.prepare('SELECT * FROM workspaces ORDER BY position').all() as Row[]).map(toWorkspace);
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Row | undefined;
    return row ? toWorkspace(row) : null;
  }

  createWorkspace(ws: Omit<Workspace, 'activeTabId' | 'hibernateAfterMin' | 'hiddenHibernateMin' | 'temporary' | 'icon'> & { hibernateAfterMin?: number; hiddenHibernateMin?: number | null; temporary?: boolean }): Workspace {
    const { next } = this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM workspaces').get() as { next: number };
    const hibernateAfterMin = ws.hibernateAfterMin ?? 30;
    const temporary = ws.temporary ?? false;
    const hiddenHibernateMin = ws.hiddenHibernateMin === undefined ? 10 : ws.hiddenHibernateMin;
    this.db.prepare('INSERT INTO workspaces(id, name, color, home, position, created_at, hibernate_after_min, hidden_hibernate_min, temporary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ws.id, ws.name, ws.color, ws.home, next, Date.now(), hibernateAfterMin, hiddenHibernateMin, temporary ? 1 : 0);
    return { ...ws, hibernateAfterMin, hiddenHibernateMin, temporary, activeTabId: null, icon: null };
  }

  /** Apaga os workspaces temporários (ao abrir e ao fechar). Devolve os ids apagados. */
  deleteTemporaryWorkspaces(): string[] {
    const ids = (this.db.prepare('SELECT id FROM workspaces WHERE temporary = 1').all() as Row[]).map((r) => r.id as string);
    for (const id of ids) this.deleteWorkspace(id);
    return ids;
  }

  /** Ícone do workspace (null = volta para a primeira letra). */
  setWorkspaceIcon(id: string, icon: string | null): void {
    this.db.prepare('UPDATE workspaces SET icon = ? WHERE id = ?').run(icon, id);
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

  // ------------------------------------------------------------ sincronização (gravação direta)

  /** Posição de um workspace/painel (ordem vinda de outro computador). */
  setRowPosition(table: 'workspaces' | 'panels', id: string, position: number): void {
    this.db.prepare(`UPDATE ${table === 'workspaces' ? 'workspaces' : 'panels'} SET position = ? WHERE id = ?`).run(position, id);
  }

  /** Grava o favorito/pasta exatamente como veio (id, pasta, posição). */
  putBookmark(b: Omit<Bookmark, 'favicon'> & { position: number }): void {
    this.db.prepare(`INSERT INTO bookmarks(id, workspace_id, title, url, favicon, position, created_at, parent_id, is_folder) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, title = excluded.title, url = excluded.url,
        position = excluded.position, parent_id = excluded.parent_id, is_folder = excluded.is_folder`)
      .run(b.id, b.workspaceId, b.title, b.url, b.position, Date.now(), b.parentId, b.folder ? 1 : 0);
  }

  /** Apaga só esta linha (sem levar o que está dentro: a sincronização já decidiu). */
  deleteBookmarkRow(id: string): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------ lista de downloads

  saveDownload(d: SavedDownload): void {
    this.db.prepare(`INSERT INTO downloads(id, filename, url, path, state, received, total, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET filename = excluded.filename, path = excluded.path, state = excluded.state,
        received = excluded.received, total = excluded.total`)
      .run(d.id, d.filename, d.url, d.path, d.state, d.received, d.total, d.startedAt);
  }

  /** Mais recentes primeiro, desde `since` (ms). */
  listDownloads(since: number): SavedDownload[] {
    return (this.db.prepare('SELECT * FROM downloads WHERE started_at >= ? ORDER BY started_at DESC').all(since) as Row[]).map((r) => ({
      id: r.id as string, filename: r.filename as string, url: r.url as string, path: r.path as string,
      state: r.state as SavedDownload['state'], received: r.received as number, total: r.total as number, startedAt: r.started_at as number,
    }));
  }

  deleteDownload(id: string): void {
    this.db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
  }

  /** Apaga os mais antigos que `before` (ms); before = Infinity apaga tudo. */
  pruneDownloads(before: number): void {
    if (before === Infinity) this.db.prepare('DELETE FROM downloads').run();
    else this.db.prepare('DELETE FROM downloads WHERE started_at < ?').run(before);
  }

  // ------------------------------------------------------------ histórico de visitas

  recordVisit(workspaceId: string, url: string, title: string, now = Date.now()): void {
    this.db.prepare(`INSERT INTO history(workspace_id, url, title, search, visits, last_visit) VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(workspace_id, url) DO UPDATE SET visits = visits + 1, last_visit = excluded.last_visit,
        title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END,
        search = CASE WHEN excluded.title <> '' THEN excluded.search ELSE search END`)
      .run(workspaceId, url, title, historySearchText(url, title), now);
  }

  /** O título chega depois da navegação: atualiza a visita (se existir). */
  setVisitTitle(workspaceId: string, url: string, title: string): void {
    this.db.prepare('UPDATE history SET title = ?, search = ? WHERE workspace_id = ? AND url = ?')
      .run(title, historySearchText(url, title), workspaceId, url);
  }

  /** Cada palavra tem que aparecer (sem acento/maiúscula) no título ou no endereço. */
  searchHistory(workspaceId: string, query: string, limit = 8): HistoryEntry[] {
    const words = fold(query).split(/\s+/).filter(Boolean).slice(0, 8);
    if (!words.length) return [];
    const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const where = words.map(() => "search LIKE ? ESCAPE '\\'").join(' AND ');
    // Mais visitado e mais recente primeiro (frecência simples).
    return (this.db.prepare(`SELECT url, title, visits, last_visit FROM history WHERE workspace_id = ? AND ${where}
      ORDER BY (visits * 1.0) / (1 + (? - last_visit) / 86400000.0) DESC LIMIT ?`)
      .all(workspaceId, ...words.map(like), Date.now(), limit) as Row[])
      .map((r) => ({ url: r.url as string, title: r.title as string, visits: r.visits as number, lastVisit: r.last_visit as number }));
  }

  /** Janela de histórico: mais recentes primeiro (filtrado pelas palavras, se houver). */
  recentHistory(workspaceId: string, query: string, limit = 300): HistoryEntry[] {
    const words = fold(query).split(/\s+/).filter(Boolean).slice(0, 8);
    const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const where = words.map(() => " AND search LIKE ? ESCAPE '\\'").join('');
    return (this.db.prepare(`SELECT url, title, visits, last_visit FROM history WHERE workspace_id = ?${where}
      ORDER BY last_visit DESC LIMIT ?`).all(workspaceId, ...words.map(like), limit) as Row[])
      .map((r) => ({ url: r.url as string, title: r.title as string, visits: r.visits as number, lastVisit: r.last_visit as number }));
  }

  deleteVisit(workspaceId: string, url: string): void {
    this.db.prepare('DELETE FROM history WHERE workspace_id = ? AND url = ?').run(workspaceId, url);
  }

  clearHistory(): void {
    this.db.prepare('DELETE FROM history').run();
  }

  /** Mantém só os últimos `maxAgeDays` e, por workspace, os `maxPerWorkspace` mais recentes. */
  pruneHistory(maxAgeDays = 90, maxPerWorkspace = 5000, now = Date.now()): void {
    this.db.prepare('DELETE FROM history WHERE last_visit < ?').run(now - maxAgeDays * 86_400_000);
    this.db.prepare(`DELETE FROM history WHERE rowid IN (SELECT rowid FROM (SELECT rowid,
      ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY last_visit DESC) AS n FROM history) WHERE n > ?)`).run(maxPerWorkspace);
  }

  // ------------------------------------------------------------ zoom por site

  /** Zoom guardado do site (1 = 100%, o padrão: não guardado). */
  getZoom(workspaceId: string, host: string): number {
    const row = this.db.prepare('SELECT factor FROM site_zoom WHERE workspace_id = ? AND host = ?').get(workspaceId, host) as { factor: number } | undefined;
    return row?.factor ?? 1;
  }

  setZoom(workspaceId: string, host: string, factor: number): void {
    if (Math.abs(factor - 1) < 0.001) {
      this.db.prepare('DELETE FROM site_zoom WHERE workspace_id = ? AND host = ?').run(workspaceId, host);
    } else {
      this.db.prepare(`INSERT INTO site_zoom(workspace_id, host, factor) VALUES (?, ?, ?)
        ON CONFLICT(workspace_id, host) DO UPDATE SET factor = excluded.factor`).run(workspaceId, host, factor);
    }
  }

  // ------------------------------------------------------------ favoritos (por workspace, com pastas)

  /** Todos os favoritos e pastas do workspace, em ordem (pai, posição). */
  listBookmarks(workspaceId: string): Bookmark[] {
    return (this.db.prepare('SELECT * FROM bookmarks WHERE workspace_id = ? ORDER BY position').all(workspaceId) as Row[]).map(toBookmark);
  }

  /** Filhos diretos de uma pasta (null = raiz / barra de favoritos), em ordem. */
  childBookmarks(workspaceId: string, parentId: string | null): Bookmark[] {
    return this.listBookmarks(workspaceId).filter((b) => b.parentId === parentId);
  }

  getBookmark(id: string): Bookmark | null {
    const row = this.db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id) as Row | undefined;
    return row ? toBookmark(row) : null;
  }

  /** Favorito (não pasta) da URL neste workspace (ignora só a barra final e o #fragmento). */
  findBookmark(workspaceId: string, url: string): Bookmark | null {
    const norm = normalizeBookmarkUrl(url);
    return this.listBookmarks(workspaceId).find((b) => !b.folder && normalizeBookmarkUrl(b.url) === norm) ?? null;
  }

  private nextPosition(workspaceId: string, parentId: string | null): number {
    const { next } = this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM bookmarks WHERE workspace_id = ? AND parent_id IS ?')
      .get(workspaceId, parentId) as { next: number };
    return next;
  }

  addBookmark(b: Pick<Bookmark, 'id' | 'workspaceId' | 'title' | 'url' | 'favicon'> & { parentId?: string | null }): Bookmark {
    const parentId = this.validParent(b.workspaceId, b.parentId ?? null);
    this.db.prepare('INSERT INTO bookmarks(id, workspace_id, title, url, favicon, position, created_at, parent_id, is_folder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
      .run(b.id, b.workspaceId, b.title, b.url, b.favicon, this.nextPosition(b.workspaceId, parentId), Date.now(), parentId);
    return this.getBookmark(b.id)!;
  }

  addFolder(f: { id: string; workspaceId: string; title: string; parentId?: string | null }): Bookmark {
    const parentId = this.validParent(f.workspaceId, f.parentId ?? null);
    this.db.prepare("INSERT INTO bookmarks(id, workspace_id, title, url, favicon, position, created_at, parent_id, is_folder) VALUES (?, ?, ?, '', NULL, ?, ?, ?, 1)")
      .run(f.id, f.workspaceId, f.title, this.nextPosition(f.workspaceId, parentId), Date.now(), parentId);
    return this.getBookmark(f.id)!;
  }

  /**
   * Importação: cria a pasta `title` no fim da barra do workspace e, dentro dela, a árvore
   * inteira (numa transação só). Devolve o id da pasta criada.
   */
  importBookmarkTree(workspaceId: string, title: string, nodes: ImportTreeNode[], makeId: () => string): string {
    return this.tx(() => {
      const root = this.addFolder({ id: makeId(), workspaceId, title }).id;
      const insert = (parentId: string, list: ImportTreeNode[]) => list.forEach((n, position) => {
        const id = makeId();
        this.db.prepare(`INSERT INTO bookmarks(id, workspace_id, title, url, favicon, position, created_at, parent_id, is_folder)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`).run(id, workspaceId, n.title, n.url ?? '', position, Date.now(), parentId, n.url ? 0 : 1);
        if (!n.url) insert(id, n.children ?? []);
      });
      insert(root, nodes);
      return root;
    });
  }

  /** Pai só se for uma pasta do mesmo workspace; senão, raiz. */
  private validParent(workspaceId: string, parentId: string | null): string | null {
    if (!parentId) return null;
    const p = this.getBookmark(parentId);
    return p && p.folder && p.workspaceId === workspaceId ? p.id : null;
  }

  renameBookmark(id: string, title: string): void {
    this.db.prepare('UPDATE bookmarks SET title = ? WHERE id = ?').run(title, id);
  }

  updateBookmark(id: string, patch: { title: string; url: string }): void {
    this.db.prepare('UPDATE bookmarks SET title = ?, url = ? WHERE id = ? AND is_folder = 0').run(patch.title, patch.url, id);
  }

  /** Remove o favorito; pasta leva junto tudo o que tem dentro (subpastas inclusive). */
  removeBookmark(id: string): void {
    const b = this.getBookmark(id);
    if (!b) return;
    const all = this.listBookmarks(b.workspaceId);
    const doomed = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const x of all) if (x.parentId && doomed.has(x.parentId) && !doomed.has(x.id)) { doomed.add(x.id); grew = true; }
    }
    this.tx(() => { for (const x of doomed) this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(x); });
  }

  /** Pasta `folderId` é `id` ou está dentro dele? (impede mover uma pasta para dentro dela mesma) */
  private isInside(folderId: string | null, id: string): boolean {
    for (let cur = folderId; cur; cur = this.getBookmark(cur)?.parentId ?? null) if (cur === id) return true;
    return false;
  }

  /**
   * Move para a pasta `parentId` (null = barra), na posição final `index` entre os filhos dela.
   * Mover uma pasta para dentro dela mesma (ou de uma subpasta) é ignorado.
   */
  moveBookmark(id: string, parentId: string | null, index: number): void {
    const b = this.getBookmark(id);
    if (!b) return;
    const target = parentId === null ? null : this.validParent(b.workspaceId, parentId);
    if (parentId !== null && target === null) return;
    if (this.isInside(target, id)) return;
    const ids = this.childBookmarks(b.workspaceId, target).map((x) => x.id).filter((x) => x !== id);
    ids.splice(Math.min(Math.max(0, index), ids.length), 0, id);
    this.tx(() => {
      this.db.prepare('UPDATE bookmarks SET parent_id = ? WHERE id = ?').run(target, id);
      ids.forEach((x, i) => this.db.prepare('UPDATE bookmarks SET position = ? WHERE id = ?').run(i, x));
    });
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
