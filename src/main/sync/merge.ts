// Dados sincronizados e a mesclagem em três vias (puro).
//
// Cada coleção é um mapa id → registro. Comparando com a última versão sincronizada
// (base): o que só mudou de um lado vale; o que mudou dos dois lados fica com a versão
// deste computador; apagado de um lado e editado do outro fica (não se perde edição).

export interface SyncWorkspace { name: string; color: string; home: string; hibernateAfterMin: number; hiddenHibernateMin: number | null; position: number }
export interface SyncBookmark { workspaceId: string; parentId: string | null; folder: boolean; title: string; url: string; position: number }
export interface SyncPanel { workspaceId: string; url: string; mobile: boolean; width: number; hibernateMin: number | null; position: number }
export interface SyncCustomization { name: string; sites: string; css: string; js: string; enabled: boolean }

export interface SyncData {
  v: 1;
  workspaces: Record<string, SyncWorkspace>;
  bookmarks: Record<string, SyncBookmark>;
  panels: Record<string, SyncPanel>;
  customizations: Record<string, SyncCustomization>;
  prefs: Record<string, string>;
}

export const COLLECTIONS = ['workspaces', 'bookmarks', 'panels', 'customizations', 'prefs'] as const;
export type Collection = typeof COLLECTIONS[number];

export const emptyData = (): SyncData => ({ v: 1, workspaces: {}, bookmarks: {}, panels: {}, customizations: {}, prefs: {} });

/** Igualdade estrutural (registros simples; ordem das chaves não importa). */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function merge3Map<T>(base: Record<string, T>, local: Record<string, T>, remote: Record<string, T>, prefer: 'local' | 'remote'): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[id], l = local[id], r = remote[id];
    let v: T | undefined;
    if (same(l, r)) v = l;
    else if (same(l, b)) v = r; // só o remoto mudou (ou apagou, ou criou)
    else if (same(r, b)) v = l; // só este computador mudou
    else if (l === undefined || r === undefined) v = l ?? r; // apagado de um lado e editado do outro: fica a edição
    else v = prefer === 'local' ? l : r; // os dois mudaram
    if (v !== undefined) out[id] = v;
  }
  return out;
}

/**
 * prefer: quem vence quando os dois lados mudaram o mesmo item. 'remote' na primeira
 * conexão de um computador (a nuvem já tem os dados "de verdade").
 */
export function merge3(base: SyncData, local: SyncData, remote: SyncData, prefer: 'local' | 'remote' = 'local'): SyncData {
  const out = emptyData();
  for (const c of COLLECTIONS) (out as unknown as Record<Collection, Record<string, unknown>>)[c] = merge3Map(base[c] as Record<string, unknown>, local[c] as Record<string, unknown>, remote[c] as Record<string, unknown>, prefer);
  // Cópia: a normalização mexe nas posições e não pode alterar os dados de entrada.
  return normalizePositions(dropOrphans(structuredClone(out)));
}

/**
 * Posições 0..n em cada nível (itens de computadores diferentes podem chegar na mesma
 * posição): ordem por posição e, no empate, pelo id — todos os computadores chegam à mesma.
 */
export function normalizePositions(d: SyncData): SyncData {
  const renumber = <T extends { position: number }>(items: [string, T][]) =>
    items.sort((a, b) => a[1].position - b[1].position || (a[0] < b[0] ? -1 : 1)).forEach(([, v], i) => { v.position = i; });
  renumber(Object.entries(d.workspaces));
  const groups = new Map<string, [string, SyncBookmark][]>();
  for (const e of Object.entries(d.bookmarks)) {
    const k = `${e[1].workspaceId}|${e[1].parentId ?? ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  for (const g of groups.values()) renumber(g);
  renumber(Object.entries(d.panels));
  return d;
}

/** Favoritos/painéis de workspace que não existe mais, e favoritos em pasta que sumiu, saem. */
export function dropOrphans(d: SyncData): SyncData {
  for (const [id, b] of Object.entries(d.bookmarks)) if (!d.workspaces[b.workspaceId]) delete d.bookmarks[id];
  for (const [id, p] of Object.entries(d.panels)) if (!d.workspaces[p.workspaceId]) delete d.panels[id];
  for (let changed = true; changed;) {
    changed = false;
    for (const [id, b] of Object.entries(d.bookmarks)) {
      const parent = b.parentId ? d.bookmarks[b.parentId] : null;
      if (b.parentId && (!parent || !parent.folder)) { delete d.bookmarks[id]; changed = true; }
    }
  }
  return d;
}

export interface Changes { upsert: Partial<Record<Collection, string[]>>; remove: Partial<Record<Collection, string[]>> }

/** O que aplicar em `from` para chegar a `to` (ids por coleção). */
export function diff(from: SyncData, to: SyncData): Changes {
  const ch: Changes = { upsert: {}, remove: {} };
  for (const c of COLLECTIONS) {
    const f = from[c] as Record<string, unknown>, t = to[c] as Record<string, unknown>;
    const up = Object.keys(t).filter((id) => !same(f[id], t[id]));
    const rm = Object.keys(f).filter((id) => !(id in t));
    if (up.length) ch.upsert[c] = up;
    if (rm.length) ch.remove[c] = rm;
  }
  return ch;
}

export const hasChanges = (c: Changes) => Object.keys(c.upsert).length > 0 || Object.keys(c.remove).length > 0;

/** Valida o que veio da nuvem (depois de decifrar): formato inesperado = erro, nunca aplicar lixo. */
export function parseData(raw: unknown): SyncData {
  const d = raw as SyncData;
  if (!d || d.v !== 1) throw new Error('formato de sincronização desconhecido');
  for (const c of COLLECTIONS) if (!d[c] || typeof d[c] !== 'object' || Array.isArray(d[c])) throw new Error(`coleção inválida: ${c}`);
  return dropOrphans({ v: 1, workspaces: d.workspaces, bookmarks: d.bookmarks, panels: d.panels, customizations: d.customizations, prefs: d.prefs });
}
