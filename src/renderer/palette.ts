// Paleta de comandos: busca tolerante e montagem dos itens (puro, testável).
import type { UiCommand, UiState } from '../shared/types';

export type PaletteAction =
  | { kind: 'command'; command: UiCommand }
  | { kind: 'ui'; action: 'settings' | 'vault' | 'new-workspace' | 'modules' | 'bookmark' };

export interface PaletteItem {
  id: string;
  title: string;
  /** Texto menor (URL, workspace…). */
  detail: string;
  group: 'Abas' | 'Favoritos' | 'Histórico' | 'Workspaces' | 'Painéis' | 'Ações' | 'Abrir';
  action: PaletteAction;
  /** Já filtrado pela busca em outro lugar (histórico: palavras em qualquer ordem): nunca descartar. */
  prematched?: boolean;
}

import { fold } from '../shared/text';
export { fold };

/**
 * Pontua `text` para a busca `query` (letras em ordem, não precisam ser contíguas).
 * null = não casa. Mais pontos para começo de palavra, sequências e casamento no início.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).replace(/\s+/g, '');
  if (!q) return 0;
  const t = fold(text);
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return null;
    const wordStart = i === 0 || /[\s/.\-_:]/.test(t[i - 1]);
    score += 1 + (wordStart ? 6 : 0) + (i === prev + 1 ? 4 : 0) - Math.min(i - ti, 5) * 0.2;
    prev = i;
    ti = i + 1;
  }
  if (t.startsWith(fold(query).trim())) score += 10;
  return score;
}

/** Filtra e ordena: melhor pontuação primeiro; empate mantém a ordem original (grupos). */
export function rank(items: PaletteItem[], query: string): PaletteItem[] {
  if (!query.trim()) return items;
  return items
    .map((item, i) => {
      let s = Math.max(fuzzyScore(query, item.title) ?? -Infinity, (fuzzyScore(query, item.detail) ?? -Infinity) - 3);
      if (item.prematched && s === -Infinity) s = 0; // casou por palavras, fora de ordem
      return { item, i, s };
    })
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

// ------------------------------------------------------------ itens

export interface PaletteContext {
  state: UiState;
  query: string;
  /** URL que a busca vira (ou pesquisa); null se vazia. */
  openUrl: string | null;
}

/** URL para exibir: sem esquema e com caracteres decodificados ("%20" → espaço). */
export function readableUrl(url: string): string {
  let u = url.replace(/^https?:\/\//, '');
  try { u = decodeURI(u); } catch { /* URL malformada: mostra como está */ }
  return u;
}

export function buildItems({ state: s, query, openUrl }: PaletteContext): PaletteItem[] {
  const active = s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  const wsName = new Map(s.workspaces.map((w) => [w.id, w.name]));
  const cmd = (command: UiCommand): PaletteAction => ({ kind: 'command', command });
  const items: PaletteItem[] = [];

  items.push(...(s.paletteTabs ?? [])
    .filter((t) => t.id !== s.activeTabId)
    .map((t): PaletteItem => ({
      id: `tab:${t.id}`, title: t.title || t.url, group: 'Abas',
      detail: `${wsName.get(t.workspaceId) ?? ''} · ${readableUrl(t.url)}`,
      action: cmd({ type: 'tab:reveal', tabId: t.id }),
    })));

  items.push(...(s.bookmarks ?? []).map((b): PaletteItem => ({
    id: `bm:${b.id}`, title: b.title, detail: readableUrl(b.url), group: 'Favoritos',
    action: cmd({ type: 'bookmark:open', bookmarkId: b.id }),
  })));

  // Histórico (já filtrado pelo main com o que foi digitado). Sem repetir abas abertas e favoritos.
  // Abre na própria aba se ela estiver na página inicial, senão numa nova.
  const shown = new Set([...(s.paletteTabs ?? []).map((t) => t.url), ...(s.bookmarks ?? []).map((b) => b.url)]);
  const onHome = Boolean(active && active.url.startsWith('apollo://home') && !active.live);
  items.push(...(s.paletteHistory ?? []).filter((h) => !shown.has(h.url)).map((h): PaletteItem => ({
    id: `hist:${h.url}`, title: h.title || readableUrl(h.url), detail: readableUrl(h.url), group: 'Histórico', prematched: true,
    action: cmd(onHome ? { type: 'tab:navigate', url: h.url } : { type: 'tab:new', url: h.url }),
  })));

  items.push(...s.workspaces.filter((w) => w.id !== s.activeWorkspaceId).map((w): PaletteItem => ({
    id: `ws:${w.id}`, title: `Ir para o workspace ${w.name}`, detail: w.temporary ? 'temporário' : '', group: 'Workspaces',
    action: cmd({ type: 'workspace:switch', workspaceId: w.id }),
  })));

  items.push(...(s.panels ?? []).map((p): PaletteItem => ({
    id: `panel:${p.id}`, title: `${p.id === s.activePanelId ? 'Fechar o painel' : 'Painel'}: ${p.title || readableUrl(p.url)}`,
    detail: wsName.get(p.workspaceId) ?? '', group: 'Painéis', action: cmd({ type: 'panel:toggle', panelId: p.id }),
  })));

  const a = (id: string, title: string, action: PaletteAction, detail = '') => items.push({ id: `act:${id}`, title, detail, group: 'Ações', action });
  a('new-tab', 'Nova aba', cmd({ type: 'tab:new' }), 'Ctrl+T');
  a('reopen', 'Reabrir aba fechada', cmd({ type: 'tab:reopen' }), 'Ctrl+Shift+T');
  if (active) {
    a('pin', active.pinned ? 'Desafixar esta aba' : 'Fixar esta aba', cmd({ type: 'tab:pin', tabId: active.id, pinned: !active.pinned }));
    a('duplicate', 'Duplicar esta aba', cmd({ type: 'tab:duplicate', tabId: active.id }));
    a('group', 'Adicionar esta aba a um novo grupo', cmd({ type: 'group:create', tabId: active.id }));
    a('close', 'Fechar esta aba', cmd({ type: 'tab:close', tabId: active.id }), 'Ctrl+W');
    a('hibernate-others', 'Hibernar as outras abas', cmd({ type: 'tab:hibernate-others', tabId: active.id }));
  }
  if (active && !active.url.startsWith('apollo:')) {
    a('bookmark', s.activeBookmarkId ? 'Editar o favorito desta página' : 'Adicionar esta página aos favoritos',
      { kind: 'ui', action: 'bookmark' }, 'Ctrl+D');
  }
  if (active?.live) {
    a('zoom-in', 'Aumentar o zoom', cmd({ type: 'zoom:set', dir: 'in' }), 'Ctrl+=');
    a('zoom-out', 'Diminuir o zoom', cmd({ type: 'zoom:set', dir: 'out' }), 'Ctrl+-');
    if (s.zoom !== 100) a('zoom-reset', `Voltar o zoom a 100% (está em ${s.zoom}%)`, cmd({ type: 'zoom:set', dir: 'reset' }), 'Ctrl+0');
  }
  a('memory', s.memory ? 'Fechar o monitor de memória' : 'Monitor de memória', cmd({ type: 'memory:toggle', open: !s.memory }), 'Shift+Esc');
  if (s.sitePrivacy) {
    a('pause', s.sitePrivacy.tabPaused ? 'Retomar a proteção nesta aba' : 'Pausar a proteção nesta aba',
      cmd({ type: 'privacy:pause-tab', paused: !s.sitePrivacy.tabPaused }));
  }
  if (s.vault.status === 'unlocked') {
    if (s.vaultSite?.count) a('autofill', 'Bitwarden: preencher login', cmd({ type: 'vault:autofill' }), 'Ctrl+Shift+L');
    a('vault-lock', 'Bitwarden: bloquear o cofre', cmd({ type: 'vault:lock' }));
  } else {
    a('vault-open', s.vault.status === 'locked' ? 'Bitwarden: desbloquear o cofre' : 'Bitwarden: conectar', { kind: 'ui', action: 'vault' });
  }
  a('generate', 'Gerar senha e copiar', cmd({ type: 'vault:generate', fill: false }));
  a('new-ws', 'Novo workspace', { kind: 'ui', action: 'new-workspace' });
  a('settings', 'Configurações', { kind: 'ui', action: 'settings' });
  a('modules', 'Módulos e personalizações', { kind: 'ui', action: 'modules' });

  const ranked = rank(items, query);
  // Endereço/pesquisa digitado: sempre disponível, no topo se nada casar bem.
  if (openUrl && query.trim()) {
    const open: PaletteItem = { id: 'open', title: `Abrir ${query.trim()}`, detail: openUrl, group: 'Abrir',
      action: cmd({ type: 'tab:new', url: openUrl }) };
    return ranked.length && (fuzzyScore(query, ranked[0].title) ?? 0) > 20 ? [...ranked, open] : [open, ...ranked];
  }
  return ranked;
}
