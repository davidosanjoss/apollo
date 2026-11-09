import type { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PermissionDecision, PermissionKind } from '../shared/types';

export interface Workspace {
  id: string;
  name: string;
  color: string;
  home: string;
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
}

export const newId = (): string => randomUUID().replaceAll('-', '').slice(0, 12);

type Row = Record<string, unknown>;

const toWorkspace = (r: Row): Workspace => ({
  id: r.id as string,
  name: r.name as string,
  color: r.color as string,
  home: r.home as string,
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
});

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

  createWorkspace(ws: Omit<Workspace, 'activeTabId'>): Workspace {
    const { next } = this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM workspaces').get() as { next: number };
    this.db.prepare('INSERT INTO workspaces(id, name, color, home, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ws.id, ws.name, ws.color, ws.home, next, Date.now());
    return { ...ws, activeTabId: null };
  }

  updateWorkspace(id: string, patch: Pick<Workspace, 'name' | 'color' | 'home'>): void {
    this.db.prepare('UPDATE workspaces SET name = ?, color = ?, home = ? WHERE id = ?')
      .run(patch.name, patch.color, patch.home, id);
  }

  deleteWorkspace(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
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
  insertTab(tab: Pick<Tab, 'id' | 'workspaceId' | 'url' | 'title'>, afterTabId: string | null): Tab {
    return this.tx(() => {
      let position: number;
      const after = afterTabId ? this.getTab(afterTabId) : null;
      if (after && after.workspaceId === tab.workspaceId) {
        position = after.position + 1;
        this.db.prepare('UPDATE tabs SET position = position + 1 WHERE workspace_id = ? AND position >= ?')
          .run(tab.workspaceId, position);
      } else {
        position = (this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM tabs WHERE workspace_id = ?')
          .get(tab.workspaceId) as { next: number }).next;
      }
      this.db.prepare('INSERT INTO tabs(id, workspace_id, position, url, title) VALUES (?, ?, ?, ?, ?)')
        .run(tab.id, tab.workspaceId, position, tab.url, tab.title);
      return this.getTab(tab.id)!;
    });
  }

  updateTab(id: string, patch: Partial<Pick<Tab, 'url' | 'title' | 'favicon'>>): void {
    const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (fields.length === 0) return;
    const sql = `UPDATE tabs SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...fields.map(([, v]) => v as string | null), id);
  }

  deleteTab(id: string): void {
    this.db.prepare('DELETE FROM tabs WHERE id = ?').run(id);
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

  // ------------------------------------------------------------ migração do protótipo

  /**
   * Importa o state.json da v0.1.0. Mantém os IDs dos workspaces, porque a partição
   * de sessão (persist:ws-<id>) depende deles — é isso que preserva os logins.
   */
  importLegacyState(file: string): boolean {
    if (!fs.existsSync(file) || this.listWorkspaces().length > 0) return false;
    const legacy = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      activeWorkspaceId?: string;
      workspaces?: { id: string; name: string; color: string; home?: string; activeTabId?: string;
        tabs?: { id: string; url?: string; title?: string; favicon?: string }[] }[];
    };
    if (!Array.isArray(legacy.workspaces) || legacy.workspaces.length === 0) return false;

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
