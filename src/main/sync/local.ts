// Ponte entre os dados locais e os sincronizados: monta o retrato (com os ids que os
// outros computadores conhecem) e aplica as mudanças vindas da mesclagem.
import type { Store } from '../store';
import { emptyData, type Changes, type SyncData } from './merge';

/** Preferências que viajam (o resto — DNS, módulos, janela — é de cada computador). */
export const SYNC_PREFS = ['spellcheck', 'history-off', 'bookmark-bar', 'download-days', 'download-ask', 'auto-pip', 'reader-style'];

/** Workspace local → id nos outros computadores (mesmo nome na primeira conexão). */
export type WorkspaceMap = Record<string, string>;

export function parseWorkspaceMap(raw: string | null): WorkspaceMap {
  try { const v = JSON.parse(raw ?? '{}'); return v && typeof v === 'object' ? v as WorkspaceMap : {}; } catch { return {}; }
}

export function snapshot(store: Store, map: WorkspaceMap): SyncData {
  const d = emptyData();
  const out = (id: string) => map[id] ?? id;
  const workspaces = store.listWorkspaces().filter((w) => !w.temporary);
  const kept = new Set(workspaces.map((w) => w.id));
  workspaces.forEach((w, position) => {
    d.workspaces[out(w.id)] = { name: w.name, color: w.color, home: w.home, hibernateAfterMin: w.hibernateAfterMin,
      hiddenHibernateMin: w.hiddenHibernateMin, position, ...(w.icon ? { icon: w.icon } : {}) };
  });
  for (const w of workspaces) {
    for (const b of store.listBookmarks(w.id)) {
      const position = store.childBookmarks(w.id, b.parentId).findIndex((x) => x.id === b.id);
      d.bookmarks[b.id] = { workspaceId: out(w.id), parentId: b.parentId, folder: b.folder, title: b.title, url: b.url, position };
    }
  }
  store.listPanels().filter((p) => kept.has(p.workspaceId)).forEach((p, position) => {
    d.panels[p.id] = { workspaceId: out(p.workspaceId), url: p.url, mobile: p.mobile, width: p.width, hibernateMin: p.hibernateMin, position };
  });
  for (const c of store.listCustomizations()) d.customizations[c.id] = { name: c.name, sites: c.sites, css: c.css, js: c.js, enabled: c.enabled };
  for (const k of SYNC_PREFS) { const v = store.getKv(k); if (v !== null) d.prefs[k] = v; }
  return d;
}

/**
 * Primeira conexão deste computador a uma nuvem que já tem dados: workspaces com o
 * mesmo nome passam a ser o mesmo (ex.: o "Principal" de cada PC).
 */
export function matchWorkspaces(store: Store, remote: SyncData, map: WorkspaceMap): WorkspaceMap {
  const next = { ...map };
  const taken = new Set(Object.values(next));
  const norm = (s: string) => s.trim().toLowerCase();
  for (const w of store.listWorkspaces().filter((x) => !x.temporary)) {
    if (next[w.id] || remote.workspaces[w.id]) continue;
    const match = Object.entries(remote.workspaces).find(([id, r]) => !taken.has(id) && norm(r.name) === norm(w.name));
    if (match) { next[w.id] = match[0]; taken.add(match[0]); }
  }
  return next;
}

/** Ações que mexem no navegador (views, sessões), não só no banco. */
export interface ApplyHooks {
  deleteWorkspace(localId: string): void;
  removePanel(id: string): void;
  /** Painel mudou de endereço/versão: recarregar a view. */
  reloadPanel(id: string): void;
  /** Depois de tudo (preferências com efeito, garantir abas, atualizar a interface). */
  done(prefsChanged: string[]): void;
}

export function apply(store: Store, map: WorkspaceMap, merged: SyncData, ch: Changes, hooks: ApplyHooks): void {
  const reverse = Object.fromEntries(Object.entries(map).map(([l, r]) => [r, l]));
  const local = (id: string) => reverse[id] ?? id;

  // Workspaces primeiro (favoritos e painéis dependem deles).
  for (const id of ch.upsert.workspaces ?? []) {
    const w = merged.workspaces[id];
    const lid = local(id);
    if (store.getWorkspace(lid)) store.updateWorkspace(lid, { name: w.name, color: w.color, home: w.home, hibernateAfterMin: w.hibernateAfterMin, hiddenHibernateMin: w.hiddenHibernateMin });
    else store.createWorkspace({ id: lid, name: w.name, color: w.color, home: w.home, hibernateAfterMin: w.hibernateAfterMin, hiddenHibernateMin: w.hiddenHibernateMin });
    store.setWorkspaceIcon(lid, w.icon ?? null);
  }
  for (const [id, w] of Object.entries(merged.workspaces)) store.setRowPosition('workspaces', local(id), w.position);

  // Favoritos: grava/move tudo; depois apaga linha a linha (pastas já resolvidas na mesclagem).
  for (const id of ch.upsert.bookmarks ?? []) {
    const b = merged.bookmarks[id];
    store.putBookmark({ id, workspaceId: local(b.workspaceId), parentId: b.parentId, folder: b.folder, title: b.title, url: b.url, position: b.position });
  }
  for (const id of ch.remove.bookmarks ?? []) store.deleteBookmarkRow(id);

  for (const id of ch.upsert.panels ?? []) {
    const p = merged.panels[id];
    const before = store.getPanel(id);
    if (!before) store.createPanel({ id, workspaceId: local(p.workspaceId), url: p.url, mobile: p.mobile });
    store.updatePanel(id, { url: p.url, mobile: p.mobile, width: p.width, hibernateMin: p.hibernateMin });
    if (before && (before.url !== p.url || before.mobile !== p.mobile)) hooks.reloadPanel(id);
  }
  for (const [id, p] of Object.entries(merged.panels)) store.setRowPosition('panels', id, p.position);
  for (const id of ch.remove.panels ?? []) hooks.removePanel(id);

  for (const id of ch.upsert.customizations ?? []) store.saveCustomization({ id, ...merged.customizations[id] });
  for (const id of ch.remove.customizations ?? []) store.deleteCustomization(id);

  const prefs = [...(ch.upsert.prefs ?? []), ...(ch.remove.prefs ?? [])];
  for (const k of ch.upsert.prefs ?? []) store.setKv(k, merged.prefs[k]);
  for (const k of ch.remove.prefs ?? []) store.deleteKv(k);

  // Workspaces apagados por último (levam abas, sessão e o que sobrou deles).
  for (const id of ch.remove.workspaces ?? []) hooks.deleteWorkspace(local(id));
  hooks.done(prefs);
}
