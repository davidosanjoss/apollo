// UI do navegador: sem privilégios. Desenha o estado que o processo principal
// envia e devolve comandos. Toda decisão (abas, sessões, permissões) é do main.
import type { ApolloApi } from '../preload/ui';
import type { BookmarkInfo, DnsMode, DownloadAction, ScreenSource, SpellcheckMode, GroupInfo, PermissionDecision, PrivacyFeature, UiCommand, UiState, WorkspaceInfo } from '../shared/types';
import { GENERATOR_LENGTHS, GROUP_COLORS, HIDDEN_HIBERNATE_OPTIONS_MIN, PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, PANEL_SUGGESTIONS, HIBERNATE_OPTIONS_MIN, MEMORY_LIMIT_OPTIONS_MB, PERMISSION_LABELS, PRIVACY_LABELS, isHomeUrl } from '../shared/types';
import { normalizeUrl, SEARCH_URL } from '../shared/url';
import { dayLabel, downloadFraction, downloadStatus } from '../shared/format';
import { compareVersions } from '../shared/release-notes';
import { nextReaderSize, type ReaderStyle } from '../reader/template';
import { clampRatio, SPLIT_GAP } from '../main/split';
import { childrenOf, dropPlace, dropTarget, folderOptions } from './bookmark-tree';
import { hasCustomPermissions, shieldState } from '../shared/shield';
import { reconcile } from './reconcile';
import { buildStrip, computeDrop, type DropTarget, type StripItem } from './tab-strip';
import { buildItems, readableUrl, type PaletteItem } from './palette';

declare global {
  interface Window { apollo: ApolloApi }
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const send = (cmd: UiCommand) => window.apollo.send(cmd);

let state: UiState | null = null;
/** Aba cuja URL está na barra de endereço, e se o usuário editou o texto. */
let addressTabId: string | null = null;
let addressEdited = false;
let updateDismissed = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

// ------------------------------------------------------------ render

const stripEls = new Map<string, HTMLElement>();
const workspaceEls = new Map<string, HTMLElement>();

function render(): void {
  if (!state) return;
  const s = state;
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)!;
  const tab = s.tabs.find((t) => t.id === s.activeTabId) ?? null;

  document.documentElement.style.setProperty('--ws-color', ws.color);
  document.title = `${tab?.title || 'Apollo'} — ${ws.name}`;
  $('#ws-badge').textContent = ws.name;

  // sidebar
  reconcile($('#workspace-list'), workspaceEls, s.workspaces, (w) => w.id, (w) => {
    const b = el('button');
    b.onclick = () => send({ type: 'workspace:switch', workspaceId: w.id });
    b.oncontextmenu = (e) => {
      e.preventDefault();
      const current = state?.workspaces.find((x) => x.id === w.id);
      if (current) openWorkspaceDialog(current);
    };
    return b;
  }, (b, w, i) => {
    b.className = 'ws-btn' + (w.id === ws.id ? ' active' : '') + (w.temporary ? ' temporary' : '');
    b.textContent = w.icon || w.name.trim().charAt(0).toUpperCase() || '?';
    b.classList.toggle('has-icon', Boolean(w.icon));
    b.title = `${w.name}${w.temporary ? ' (temporário)' : ''}${i < 9 ? ` (Ctrl+${i + 1})` : ''}\nClique direito para editar`;
    b.style.background = w.color;
  });

  // abas (com chips de grupo)
  reconcile($('#tabs'), stripEls, buildStrip(s.tabs, s.groups, s.activeTabId), (i) => i.key,
    (i) => (i.kind === 'group' ? createGroupChip(i.group.id) : createTabEl(i.tab.id)),
    (node, i) => (i.kind === 'group' ? updateGroupChip(node, i) : updateTabEl(node, i, s.activeTabId)));

  ($('#back') as HTMLButtonElement).disabled = !tab?.canGoBack;
  ($('#forward') as HTMLButtonElement).disabled = !tab?.canGoForward;

  // Só preserva o texto da barra se o usuário o editou e continua na mesma aba;
  // senão mostra a URL da aba atual (aba vazia = barra vazia).
  const address = $<HTMLInputElement>('#address');
  const keepTyped = addressEdited && document.activeElement === address && addressTabId === (tab?.id ?? null);
  if (!keepTyped) {
    address.value = isHomeUrl(tab?.url) ? '' : tab?.url ?? '';
    addressEdited = false;
  }
  addressTabId = tab?.id ?? null;

  renderHome(s);
  renderSplit(s);
  renderFullscreen(s);
  const readerBtn = $('#reader-btn');
  readerBtn.hidden = !s.reader.available;
  readerBtn.classList.toggle('on', s.reader.active);
  readerBtn.title = s.reader.active ? 'Sair do modo leitura (F9)' : 'Modo leitura (F9)';
  $('#reader-bar').hidden = !s.reader.active;
  if (s.reader.active) {
    const f = $<HTMLSelectElement>('#reader-font'), t = $<HTMLSelectElement>('#reader-theme');
    if (document.activeElement !== f) f.value = s.reader.style.font;
    if (document.activeElement !== t) t.value = s.reader.style.theme;
  }
  const pipBtn = $('#pip-btn');
  pipBtn.hidden = !s.pip.available;
  pipBtn.classList.toggle('on', s.pip.active);
  pipBtn.title = s.pip.active ? 'Fechar o vídeo flutuante' : 'Vídeo flutuante (picture-in-picture)';
  const zoomBtn = $('#zoom-btn');
  zoomBtn.hidden = s.zoom === 100;
  zoomBtn.textContent = `${s.zoom}%`;
  renderDownloads(s);
  renderFind(s);
  renderBookmarks(s);
  renderHistory(s);
  renderPermissionPrompt(s);
  renderSavePrompt(s);
  renderSiteBar(s);
  renderUpdate(s);
  renderUpdateNotice(s);
  renderMemory(s);
  renderSettings(s);
  renderVault(s);
  renderPanels(s);
  renderModules(s);
  renderScreenPicker(s);
  renderPalette();
}

// ------------------------------------------------------------ monitor de memória

const memoryEls = new Map<string, HTMLElement>();
const fmtMb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

function renderMemory(s: UiState): void {
  const panel = $('#memory-panel');
  const m = s.memory;
  panel.hidden = !m;
  $('#memory-btn').classList.toggle('active', Boolean(m));
  if (!m) return;

  const over = m.limitMb > 0 && m.totalMb > m.limitMb;
  $('#memory-total').innerHTML = '';
  $('#memory-total').append(
    el('strong', { textContent: fmtMb(m.totalMb), className: over ? 'over' : '' }),
    ` no total · navegador e GPU: ${fmtMb(m.otherMb)}`,
  );
  const limit = $<HTMLSelectElement>('#memory-limit');
  if (document.activeElement !== limit) limit.value = String(m.limitMb);

  const wsColor = new Map(s.workspaces.map((w) => [w.id, w.color]));
  const wsName = new Map(s.workspaces.map((w) => [w.id, w.name]));
  reconcile($('#memory-tabs'), memoryEls, m.tabs, (t) => t.id, (t) => {
    const li = el('li');
    const hib = el('button', { textContent: 'Hibernar', title: 'Liberar a memória desta aba' });
    hib.onclick = (e) => { e.stopPropagation(); send({ type: 'tab:hibernate', tabId: t.id }); };
    li.append(el('span', { className: 'ws-dot' }), el('span', { className: 'name' }), el('span', { className: 'tag' }),
      el('span', { className: 'mb' }), hib);
    li.onclick = () => send({ type: 'tab:reveal', tabId: t.id });
    return li;
  }, (li, t) => {
    li.className = t.mb === null ? 'dormant' : '';
    li.dataset.tabId = t.id;
    li.title = `${t.title}\nWorkspace: ${wsName.get(t.workspaceId) ?? ''}`;
    li.querySelector<HTMLElement>('.ws-dot')!.style.background = wsColor.get(t.workspaceId) ?? 'transparent';
    li.querySelector('.name')!.textContent = t.title;
    li.querySelector('.tag')!.textContent = t.visible ? 'na tela' : t.playing ? '♪' : t.keepAwake ? 'sempre ativa' : '';
    li.querySelector('.mb')!.textContent = t.home ? 'página inicial' : t.mb === null ? 'hibernada' : fmtMb(t.mb);
    li.querySelector('button')!.disabled = t.mb === null || t.visible;
  });
}

$('#memory-limit').replaceChildren(...MEMORY_LIMIT_OPTIONS_MB.map((mb) =>
  el('option', { value: String(mb), textContent: mb === 0 ? 'Sem limite' : fmtMb(mb) })));
$<HTMLSelectElement>('#memory-limit').onchange = (e) =>
  send({ type: 'settings:memory-limit', mb: Number((e.target as HTMLSelectElement).value) });
$('#memory-btn').onclick = () => send({ type: 'memory:toggle', open: !state?.memory });
$('#memory-close').onclick = () => send({ type: 'memory:toggle', open: false });

// ------------------------------------------------------------ barra de abas

function createTabEl(tabId: string): HTMLElement {
  const item = el('div', { draggable: true });
  item.dataset.tabId = tabId;
  const img = el('img', { alt: '' });
  const letter = el('span', { className: 'letter', hidden: true });
  img.onerror = () => { img.hidden = true; letter.hidden = !item.classList.contains('pinned'); };
  const close = el('button', { className: 'close', textContent: '×', title: 'Fechar (Ctrl+W)' });
  close.onclick = (e) => { e.stopPropagation(); send({ type: 'tab:close', tabId }); };
  item.append(img, letter, el('span', { className: 'title' }), close);
  item.onclick = () => send({ type: 'tab:activate', tabId });
  item.onauxclick = (e) => { if (e.button === 1) send({ type: 'tab:close', tabId }); };
  item.oncontextmenu = (e) => { e.preventDefault(); send({ type: 'tab:menu', tabId, x: e.clientX, y: e.clientY }); };
  item.ondragstart = (e) => {
    dragging = tabId;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', '');
  };
  item.ondragend = () => { dragging = null; clearDropMarks(); };
  return item;
}

function updateTabEl(item: HTMLElement, i: Extract<StripItem, { kind: 'tab' }>, activeTabId: string | null): void {
  const t = i.tab;
  item.className = ['tab', t.id === activeTabId && 'active', t.dormant && 'dormant', t.loading && 'loading',
    t.pinned && 'pinned', i.group && 'grouped'].filter(Boolean).join(' ');
  item.hidden = i.hidden;
  item.style.setProperty('--group-color', i.group?.color ?? 'transparent');
  item.title = `${t.title || t.url}${t.keepAwake ? '\n(sempre ativa)' : ''}`;
  const img = item.querySelector('img')!;
  if (t.favicon) {
    if (img.getAttribute('src') !== t.favicon) { img.hidden = false; img.src = t.favicon; }
  } else {
    img.hidden = true;
    img.removeAttribute('src');
  }
  item.querySelector('.title')!.textContent = t.title || t.url;
  // Sem ícone, a aba fixada (que só mostra o ícone) ficaria vazia: usa a inicial.
  const letter = item.querySelector<HTMLElement>('.letter')!;
  letter.textContent = (t.title || t.url).trim().charAt(0).toUpperCase();
  letter.hidden = !t.pinned || !img.hidden;
}

function createGroupChip(groupId: string): HTMLElement {
  const chip = el('div', { className: 'group-chip' });
  chip.dataset.groupId = groupId;
  chip.onclick = () => {
    const g = state?.groups.find((x) => x.id === groupId);
    if (g) send({ type: 'group:collapse', groupId, collapsed: !g.collapsed });
  };
  chip.oncontextmenu = (e) => { e.preventDefault(); send({ type: 'group:menu', groupId, x: e.clientX, y: e.clientY }); };
  return chip;
}

function updateGroupChip(chip: HTMLElement, i: Extract<StripItem, { kind: 'group' }>): void {
  const g = i.group;
  chip.style.setProperty('--group-color', g.color);
  chip.classList.toggle('collapsed', g.collapsed);
  chip.classList.toggle('unnamed', !g.name);
  // Recolhido mostra quantas abas tem: "Faculdade (3)", ou "(3)" sem nome.
  chip.textContent = g.collapsed ? `${g.name ? `${g.name} ` : ''}(${i.count})` : g.name;
  chip.title = `${g.name || 'Grupo'} — clique para ${g.collapsed ? 'expandir' : 'recolher'}; botão direito para opções`;
}

// Arrastar e soltar abas.
let dragging: string | null = null;

function clearDropMarks(): void {
  document.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
}

function dropTargetAt(e: DragEvent): { target: DropTarget; node: HTMLElement | null } {
  const node = (e.target as HTMLElement).closest<HTMLElement>('.tab, .group-chip');
  if (node?.dataset.groupId) return { target: { kind: 'group', id: node.dataset.groupId }, node };
  if (node?.dataset.tabId) {
    const r = node.getBoundingClientRect();
    return { target: { kind: 'tab', id: node.dataset.tabId, after: e.clientX > r.left + r.width / 2 }, node };
  }
  return { target: { kind: 'end' }, node: null };
}

const tabsBar = $('#tabs');
tabsBar.addEventListener('dragover', (e) => {
  if (!dragging) return;
  e.preventDefault();
  clearDropMarks();
  const { target, node } = dropTargetAt(e);
  if (node) node.classList.add(target.kind === 'tab' && target.after ? 'drop-after' : 'drop-before');
});
tabsBar.addEventListener('dragleave', (e) => { if (e.target === tabsBar) clearDropMarks(); });
tabsBar.addEventListener('drop', (e) => {
  e.preventDefault();
  clearDropMarks();
  if (!dragging || !state) return;
  const drop = computeDrop(state.tabs, dragging, dropTargetAt(e).target);
  if (drop) send({ type: 'tab:move', tabId: dragging, index: drop.index, ...(drop.groupId !== undefined ? { groupId: drop.groupId } : {}) });
  dragging = null;
});

// ------------------------------------------------------------ página inicial (sem processo)

let homeTimer: ReturnType<typeof setTimeout> | null = null;
function homeTick(): void {
  const now = new Date();
  const h = now.getHours();
  $('#home-greeting').textContent = h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  $('#home-clock').textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  $('#home-date').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  // Próxima virada de minuto (sem timer a cada segundo; parado quando a página inicial some).
  homeTimer = setTimeout(homeTick, (60 - now.getSeconds()) * 1000);
}

function renderHome(s: UiState): void {
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  const show = Boolean(tab && isHomeUrl(tab.url) && !tab.live);
  const view = $('#home-view');
  if (show === !view.hidden) return;
  view.hidden = !show;
  if (show) homeTick();
  else if (homeTimer) { clearTimeout(homeTimer); homeTimer = null; }
}

$('#home-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $<HTMLInputElement>('#home-q');
  const url = normalizeUrl(q.value);
  if (!url) return;
  q.value = '';
  send({ type: 'tab:navigate', url });
});

// ------------------------------------------------------------ tela dividida

/** Divisória e faixa da metade ativa, na mesma conta do processo principal. */
function renderSplit(s: UiState): void {
  const sp = s.split;
  const divider = $('#split-divider');
  const bar = $('#split-bar');
  for (const t of document.querySelectorAll<HTMLElement>('#tabs .tab')) {
    t.classList.toggle('in-split', Boolean(sp && (t.dataset.tabId === sp.a || t.dataset.tabId === sp.b)));
  }
  const shown = Boolean(sp && (s.activeTabId === sp.a || s.activeTabId === sp.b));
  divider.hidden = !shown;
  bar.hidden = !shown;
  if (!sp || !shown) return;
  const width = $('#views').clientWidth;
  const usable = Math.max(0, width - SPLIT_GAP);
  const wa = Math.round(usable * clampRatio(sp.ratio));
  divider.style.left = `${wa}px`;
  const activeLeft = s.activeTabId === sp.a;
  bar.style.left = activeLeft ? '0px' : `${wa + SPLIT_GAP}px`;
  bar.style.width = `${activeLeft ? wa : usable - wa}px`;
}

{
  const divider = $('#split-divider');
  let raf = 0;
  divider.addEventListener('pointerdown', (e) => {
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
  });
  divider.addEventListener('pointermove', (e) => {
    if (!divider.hasPointerCapture(e.pointerId)) return;
    const r = $('#views').getBoundingClientRect();
    const ratio = clampRatio((e.clientX - r.left - SPLIT_GAP / 2) / Math.max(1, r.width - SPLIT_GAP));
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => send({ type: 'split:ratio', ratio }));
  });
  const end = (e: PointerEvent) => { divider.classList.remove('dragging'); if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId); };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
  divider.addEventListener('dblclick', () => send({ type: 'split:ratio', ratio: 0.5 }));
  new ResizeObserver(() => { if (state) renderSplit(state); }).observe($('#views'));
}

// ------------------------------------------------------------ tela cheia (F11)

let lastFullscreen: UiState['fullscreen'] = null;
let hintTimer: ReturnType<typeof setTimeout> | null = null;
function renderFullscreen(s: UiState): void {
  document.body.classList.toggle('fullscreen', s.fullscreen !== null);
  if (s.fullscreen === lastFullscreen) return;
  lastFullscreen = s.fullscreen;
  // Aviso de como sair (só no F11; vídeo tem o próprio Esc). A página fica por cima do HTML,
  // então o aviso aparece na faixa da interface por 2,5 s.
  const hint = $('#fullscreen-hint');
  hint.hidden = s.fullscreen !== 'window';
  if (hintTimer) clearTimeout(hintTimer);
  if (!hint.hidden) hintTimer = setTimeout(() => { hint.hidden = true; }, 2500);
}

// ------------------------------------------------------------ downloads

const downloadsDialog = $<HTMLDialogElement>('#downloads-dialog');
let knownDownloads = new Set<string>();

function renderDownloads(s: UiState): void {
  const btn = $('#downloads-btn');
  const running = s.downloads.filter((d) => d.state === 'progressing' || d.state === 'paused');
  // Anel de progresso: soma de tudo o que está baixando (tamanho conhecido).
  const known = running.filter((d) => d.total > 0);
  const p = known.length ? known.reduce((a, d) => a + d.received, 0) / known.reduce((a, d) => a + d.total, 0) : 0;
  btn.classList.toggle('running', running.length > 0);
  btn.style.setProperty('--p', String(p));
  const badge = $('#downloads-active');
  badge.hidden = running.length === 0;
  badge.textContent = String(running.length);
  btn.title = running.length ? `Downloads: ${running.length} em andamento` : 'Downloads';
  // Download novo: o botão pisca (sem abrir nada por cima da página).
  const ids = new Set(s.downloads.map((d) => d.id));
  if ([...ids].some((id) => !knownDownloads.has(id)) && knownDownloads.size + ids.size > 0) {
    btn.classList.remove('pulse');
    void btn.offsetWidth; // reinicia a animação
    btn.classList.add('pulse');
  }
  knownDownloads = ids;
  if (downloadsDialog.open) renderDownloadList(s);
}

function renderDownloadList(s: UiState): void {
  const act = (id: string, action: DownloadAction) => () => send({ type: 'download:action', downloadId: id, action });
  const button = (label: string, title: string, onclick: () => void) => {
    const b = el('button', { type: 'button', className: 'icon-btn', textContent: label, title });
    b.onclick = onclick;
    return b;
  };
  if (!s.downloads.length) {
    $('#downloads-list').replaceChildren(el('li', { className: 'empty', textContent: 'Nenhum download recente.' }));
    return;
  }
  $('#downloads-list').replaceChildren(...s.downloads.map((d) => {
    const li = el('li');
    li.dataset.downloadId = d.id;
    const done = d.state === 'completed';
    const name = el('span', { className: `name${done ? ' done' : ''}`, textContent: d.filename, title: d.url });
    if (done) name.onclick = act(d.id, 'open');
    const day = dayLabel(d.startedAt, Date.now());
    const status = el('span', { className: `status${d.state === 'interrupted' ? ' failed' : ''}`,
      textContent: day === 'Hoje' ? downloadStatus(d) : `${downloadStatus(d)} · ${day}` });
    const actions = el('span', { className: 'actions' });
    if (d.state === 'progressing') actions.append(button('⏸', 'Pausar', act(d.id, 'pause')));
    if (d.state === 'paused') actions.append(button('▶', 'Retomar', act(d.id, 'resume')));
    if (d.state === 'progressing' || d.state === 'paused') actions.append(button('✕', 'Cancelar', act(d.id, 'cancel')));
    if (done) actions.append(button('📂', 'Mostrar na pasta', act(d.id, 'show')));
    if (!(d.state === 'progressing' || d.state === 'paused')) actions.append(button('🗑', 'Tirar da lista', act(d.id, 'remove')));
    li.append(name, actions, status);
    const f = downloadFraction(d);
    if ((d.state === 'progressing' || d.state === 'paused') && f !== null) {
      const bar = el('progress');
      bar.max = 1;
      bar.value = f;
      li.append(bar);
    }
    return li;
  }));
}

$('#downloads-btn').onclick = () => {
  if (!state) return;
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
  renderDownloadList(state);
  downloadsDialog.showModal();
};
$('#downloads-clear').onclick = () => send({ type: 'download:clear' });

// ------------------------------------------------------------ localizar na página (Ctrl+F)

const findBar = $('#find-bar');
const findInput = $<HTMLInputElement>('#find-input');
let findTabId: string | null = null;

function openFind(): void {
  const tab = state?.tabs.find((t) => t.id === state?.activeTabId);
  if (!tab?.live) return; // página inicial / aba sem página: nada para buscar
  findTabId = tab.id;
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) send({ type: 'find:query', text: findInput.value, forward: true, findNext: false });
}

function closeFind(focusPage = true): void {
  if (findBar.hidden) return;
  findBar.hidden = true;
  findTabId = null;
  send({ type: 'find:close' });
  if (focusPage) send({ type: 'tab:focus' });
}

function renderFind(s: UiState): void {
  if (findBar.hidden) return;
  if (s.activeTabId !== findTabId) { closeFind(false); return; } // trocou de aba
  const f = s.find;
  const count = $('#find-count');
  if (!f || !f.text) { count.textContent = ''; findInput.classList.remove('none'); return; }
  count.textContent = f.matches ? `${f.active} de ${f.matches}` : 'Nenhum resultado';
  findInput.classList.toggle('none', f.matches === 0);
}

const findStep = (forward: boolean) => {
  if (findInput.value) send({ type: 'find:query', text: findInput.value, forward, findNext: true });
};
findInput.addEventListener('input', () => send({ type: 'find:query', text: findInput.value, forward: true, findNext: false }));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findStep(!e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('#find-next').onclick = () => findStep(true);
$('#find-prev').onclick = () => findStep(false);
$('#find-close').onclick = () => closeFind();

// ------------------------------------------------------------ favoritos (barra, pastas, gerenciador)

const bookmarkDialog = $<HTMLDialogElement>('#bookmark-dialog');
/** O que o diálogo está fazendo: editar favorito, renomear pasta ou criar pasta. */
let bookmarkMode: { kind: 'edit'; id: string } | { kind: 'folder'; id: string } | { kind: 'new-folder'; parentId: string | null } | null = null;
/** Esperando o favorito recém-criado aparecer no estado para abrir o diálogo. */
let bookmarkPending = false;

function fillFolderSelect(selected: string | null, exclude: string | null): void {
  const sel = $<HTMLSelectElement>('#bookmark-folder');
  sel.replaceChildren(...folderOptions(state?.bookmarks ?? [], exclude).map((o) => {
    const opt = el('option', { value: o.id ?? '', textContent: o.label });
    opt.selected = o.id === selected;
    return opt;
  }));
}

function showBookmarkDialog(title: string, name: string, opts: { url?: string; folder?: string | null; exclude?: string | null; removable: boolean; saveLabel?: string }): void {
  $('#bookmark-dialog-title').textContent = title;
  $<HTMLInputElement>('#bookmark-title').value = name;
  const url = $<HTMLInputElement>('#bookmark-url');
  $('#bookmark-url-row').hidden = opts.url === undefined;
  url.required = opts.url !== undefined;
  url.value = opts.url ?? '';
  $('#bookmark-folder-row').hidden = opts.folder === undefined;
  if (opts.folder !== undefined) fillFolderSelect(opts.folder, opts.exclude ?? null);
  $('#bookmark-hint').hidden = opts.url === undefined;
  $('#bookmark-remove').hidden = !opts.removable;
  $<HTMLButtonElement>('#bookmark-form button[type="submit"]').textContent = opts.saveLabel ?? 'Salvar';
  if (!bookmarkDialog.open) {
    for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) if (d.id !== 'bookmarks-manager') d.close();
    bookmarkDialog.showModal();
  }
  $<HTMLInputElement>('#bookmark-title').select();
}

function openBookmarkDialog(id: string): void {
  const b = state?.bookmarks.find((x) => x.id === id);
  if (!b) return;
  if (b.folder) {
    bookmarkMode = { kind: 'folder', id };
    showBookmarkDialog('Renomear pasta', b.title, { removable: true });
  } else {
    bookmarkMode = { kind: 'edit', id };
    showBookmarkDialog('Favorito', b.title, { url: b.url, folder: b.parentId, removable: true });
  }
}

function openNewFolderDialog(parentId: string | null): void {
  bookmarkMode = { kind: 'new-folder', parentId };
  showBookmarkDialog('Nova pasta', '', { folder: parentId, removable: false, saveLabel: 'Criar' });
}

/** Estrela / Ctrl+K: marca a página (se ainda não for) e abre o diálogo para editar. */
function bookmarkCurrent(): void {
  if (state?.activeBookmarkId) { openBookmarkDialog(state.activeBookmarkId); return; }
  bookmarkPending = true;
  send({ type: 'bookmark:add' });
}

$('#bookmark-btn').onclick = bookmarkCurrent;
$('#zoom-btn').onclick = () => send({ type: 'zoom:set', dir: 'reset' });
$('#pip-btn').onclick = () => send({ type: 'tab:pip' });
$('#reader-btn').onclick = () => send({ type: 'reader:toggle' });
$('#reader-exit').onclick = () => send({ type: 'reader:toggle' });
const readerStyle = (patch: Partial<ReaderStyle>) => { if (state) send({ type: 'reader:style', style: { ...state.reader.style, ...patch } }); };
$('#reader-smaller').onclick = () => state && readerStyle({ size: nextReaderSize(state.reader.style.size, -1) });
$('#reader-bigger').onclick = () => state && readerStyle({ size: nextReaderSize(state.reader.style.size, 1) });
$<HTMLSelectElement>('#reader-font').onchange = (e) => readerStyle({ font: (e.target as HTMLSelectElement).value as ReaderStyle['font'] });
$<HTMLSelectElement>('#reader-theme').onchange = (e) => readerStyle({ theme: (e.target as HTMLSelectElement).value as ReaderStyle['theme'] });
$('#bookmark-cancel').onclick = () => bookmarkDialog.close();
$('#bookmark-remove').onclick = () => {
  if (bookmarkMode && bookmarkMode.kind !== 'new-folder') send({ type: 'bookmark:remove', bookmarkId: bookmarkMode.id });
  bookmarkDialog.close();
};
$('#bookmark-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $<HTMLInputElement>('#bookmark-title').value.trim();
  const folder = $<HTMLSelectElement>('#bookmark-folder').value || null;
  const m = bookmarkMode;
  if (!m || !title) return;
  if (m.kind === 'edit') {
    const url = normalizeUrl($<HTMLInputElement>('#bookmark-url').value);
    if (!url) return;
    send({ type: 'bookmark:update', bookmarkId: m.id, title, url, parentId: folder });
  } else if (m.kind === 'folder') {
    send({ type: 'bookmark:rename', bookmarkId: m.id, title });
  } else {
    send({ type: 'bookmark:add-folder', title, parentId: folder });
  }
  bookmarkDialog.close();
});
bookmarkDialog.addEventListener('close', () => { bookmarkMode = null; });

const initial = (b: { title: string; url: string }) => (b.title.trim()[0] ?? readableUrl(b.url)[0] ?? '?').toUpperCase();
const clearDrop = () => {
  for (const n of document.querySelectorAll('.drop-before, .drop-after, .drop-into')) n.classList.remove('drop-before', 'drop-after', 'drop-into');
};
let draggingBookmark: string | null = null;

/**
 * Arrastar e soltar entre favoritos (barra, gerenciador, página inicial): antes/depois
 * do alvo ou dentro (pasta, pelo meio). `horizontal` = barra/página inicial.
 */
function makeDraggable(node: HTMLElement, b: BookmarkInfo, dropEl: HTMLElement, horizontal: boolean): void {
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    draggingBookmark = b.id;
    node.classList.add('dragging');
    e.dataTransfer?.setData('text/plain', b.id);
  });
  node.addEventListener('dragend', () => { draggingBookmark = null; node.classList.remove('dragging'); clearDrop(); });
  const place = (e: DragEvent) => {
    const r = dropEl.getBoundingClientRect();
    return dropPlace(b.folder, horizontal ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height);
  };
  dropEl.addEventListener('dragover', (e) => {
    if (!draggingBookmark || !state) return;
    e.stopPropagation();
    if (!dropTarget(state.bookmarks, draggingBookmark, b.id, place(e))) return;
    e.preventDefault();
    clearDrop();
    dropEl.classList.add(`drop-${place(e)}`);
  });
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const t = draggingBookmark && state ? dropTarget(state.bookmarks, draggingBookmark, b.id, place(e)) : null;
    if (t && draggingBookmark) send({ type: 'bookmark:move', bookmarkId: draggingBookmark, parentId: t.parentId, index: t.index });
    clearDrop();
  });
}

function bookmarkIcon(b: BookmarkInfo, cls: string): HTMLElement {
  const icon = el('span', { className: cls });
  if (b.folder) icon.textContent = '📁';
  else if (b.favicon) {
    const img = el('img', { src: b.favicon, alt: '' });
    img.onerror = () => { img.remove(); icon.textContent = initial(b); };
    icon.append(img);
  } else icon.textContent = initial(b);
  return icon;
}

const openBm = (b: BookmarkInfo, e: MouseEvent) => send({ type: 'bookmark:open', bookmarkId: b.id, newTab: e.ctrlKey || e.metaKey || e.button === 1 });

// --- barra de favoritos

let barKey = '';
function renderBookmarkBar(s: UiState): void {
  const bar = $('#bookmark-bar');
  bar.hidden = !s.settings.bookmarkBar;
  if (bar.hidden) return;
  const key = JSON.stringify(s.bookmarks);
  if (key === barKey) return;
  barKey = key;
  const roots = childrenOf(s.bookmarks, null);
  const items = $('#bookmark-items');
  if (!roots.length) {
    items.replaceChildren(el('span', { className: 'empty', textContent: 'Seus favoritos aparecem aqui — clique na ☆ da barra de endereço, ou com o botão direito crie pastas.' }));
  } else {
    items.replaceChildren(...roots.map((b) => {
      const btn = el('button', { type: 'button', className: 'bm', title: b.folder ? b.title : `${b.title}\n${b.url}` });
      btn.dataset.bookmarkId = b.id;
      btn.append(bookmarkIcon(b, 'i'), el('span', { className: 't', textContent: b.title || readableUrl(b.url) }));
      if (b.folder) {
        btn.onclick = () => {
          const r = btn.getBoundingClientRect();
          send({ type: 'bookmark:menu', folderId: b.id, x: r.left, y: r.bottom });
        };
      } else {
        btn.onclick = (e) => openBm(b, e);
        btn.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); openBm(b, e); } };
      }
      btn.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); send({ type: 'bookmark:context', bookmarkId: b.id, x: e.clientX, y: e.clientY }); };
      makeDraggable(btn, b, btn, true);
      return btn;
    }));
  }
  requestAnimationFrame(fitBookmarkBar);
}

/** O que não cabe na barra vai para o menu "»". */
function fitBookmarkBar(): void {
  const items = $('#bookmark-items');
  const more = $<HTMLButtonElement>('#bookmark-more');
  const buttons = [...items.querySelectorAll<HTMLElement>('.bm')];
  for (const b of buttons) b.hidden = false;
  more.hidden = true;
  const limit = items.getBoundingClientRect().right;
  const first = buttons.findIndex((b) => b.getBoundingClientRect().right > limit + 1);
  if (first < 0) return;
  more.hidden = false;
  const limit2 = items.getBoundingClientRect().right; // com o "»" visível, sobra menos espaço
  let cut = buttons.findIndex((b) => b.getBoundingClientRect().right > limit2 + 1);
  if (cut < 0) cut = first;
  buttons.slice(cut).forEach((b) => { b.hidden = true; });
  more.dataset.from = String(cut);
}
new ResizeObserver(() => fitBookmarkBar()).observe($('#bookmark-items'));
$('#bookmark-more').onclick = () => {
  const r = $('#bookmark-more').getBoundingClientRect();
  send({ type: 'bookmark:menu', folderId: null, x: r.left, y: r.bottom, from: Number($('#bookmark-more').dataset.from ?? 0) });
};
$('#bookmark-bar').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  send({ type: 'bookmark:context', bookmarkId: null, x: e.clientX, y: e.clientY });
});
// Soltar na barra vazia (fora de um item): vai para o fim da barra.
$('#bookmark-bar').addEventListener('dragover', (e) => { if (draggingBookmark) e.preventDefault(); });
$('#bookmark-bar').addEventListener('drop', (e) => {
  e.preventDefault();
  if (draggingBookmark && state) {
    send({ type: 'bookmark:move', bookmarkId: draggingBookmark, parentId: null, index: childrenOf(state.bookmarks, null).length });
  }
  clearDrop();
});

// --- gerenciador (árvore)

const managerDialog = $<HTMLDialogElement>('#bookmarks-manager');
const collapsedFolders = new Set<string>();

function openBookmarkManager(): void {
  if (!state) return;
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
  renderBookmarkManager(state);
  managerDialog.showModal();
}

function renderBookmarkManager(s: UiState): void {
  $<HTMLInputElement>('#bm-show-bar').checked = s.settings.bookmarkBar;
  const build = (parentId: string | null): HTMLElement[] => childrenOf(s.bookmarks, parentId).map((b) => {
    const li = el('li', { className: collapsedFolders.has(b.id) ? 'collapsed' : '' });
    li.setAttribute('role', 'treeitem');
    li.dataset.bookmarkId = b.id;
    const row = el('div', { className: 'row' });
    const toggle = el('button', { type: 'button', className: 'toggle', textContent: b.folder ? (collapsedFolders.has(b.id) ? '▸' : '▾') : '' });
    if (b.folder) toggle.onclick = () => { if (collapsedFolders.has(b.id)) collapsedFolders.delete(b.id); else collapsedFolders.add(b.id); renderBookmarkManager(s); };
    const title = el('span', { className: 't', textContent: b.title || readableUrl(b.url) });
    if (!b.folder) title.ondblclick = () => openBm(b, new MouseEvent('click'));
    const act = (label: string, t: string, fn: () => void) => { const x = el('button', { type: 'button', className: 'icon-btn', textContent: label, title: t }); x.onclick = fn; return x; };
    row.append(toggle, bookmarkIcon(b, 'i'), title, el('span', { className: 'u', textContent: b.folder ? '' : readableUrl(b.url) }),
      ...(b.folder ? [act('＋', 'Nova subpasta', () => openNewFolderDialog(b.id))] : []),
      act('✎', b.folder ? 'Renomear' : 'Editar', () => openBookmarkDialog(b.id)),
      act('🗑', b.folder ? 'Excluir a pasta e o que tem dentro' : 'Excluir', () => send({ type: 'bookmark:remove', bookmarkId: b.id })));
    makeDraggable(li, b, row, false);
    li.append(row);
    if (b.folder) {
      const ul = el('ul', { role: 'group' } as Partial<HTMLUListElement>);
      ul.append(...build(b.id));
      li.append(ul);
    }
    return li;
  });
  const nodes = build(null);
  $('#bm-tree').replaceChildren(...(nodes.length ? nodes : [el('li', { className: 'empty', textContent: 'Nenhum favorito neste workspace ainda.' })]));
}
$('#bm-new-folder').onclick = () => openNewFolderDialog(null);
$<HTMLInputElement>('#bm-show-bar').onchange = (e) => send({ type: 'settings:bookmark-bar', show: (e.target as HTMLInputElement).checked });

// --- estrela e blocos da página inicial (só os favoritos soltos na barra)

let homeBookmarksKey = '';
function renderBookmarks(s: UiState): void {
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  const btn = $<HTMLButtonElement>('#bookmark-btn');
  btn.hidden = !tab || isHomeUrl(tab.url) || !/^(https?|file):/i.test(tab.url);
  btn.textContent = s.activeBookmarkId ? '★' : '☆';
  btn.classList.toggle('on', Boolean(s.activeBookmarkId));
  btn.title = s.activeBookmarkId ? 'Editar o favorito (Ctrl+D)' : 'Adicionar aos favoritos (Ctrl+D)';
  if (bookmarkPending && s.activeBookmarkId) { bookmarkPending = false; openBookmarkDialog(s.activeBookmarkId); }
  renderBookmarkBar(s);
  if (managerDialog.open) renderBookmarkManager(s);

  const key = JSON.stringify(s.bookmarks);
  if (key === homeBookmarksKey) return;
  homeBookmarksKey = key;
  $('#home-bookmarks').replaceChildren(...childrenOf(s.bookmarks, null).filter((b) => !b.folder).map((b) => {
    const li = el('li');
    li.dataset.bookmarkId = b.id;
    const a = el('a', { href: b.url, title: `${b.title}\n${b.url}` });
    a.draggable = false;
    a.append(bookmarkIcon(b, 'icon'), el('span', { className: 'name', textContent: b.title }));
    a.onclick = (e) => { e.preventDefault(); openBm(b, e); };
    a.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); openBm(b, e); } };
    a.oncontextmenu = (e) => { e.preventDefault(); openBookmarkDialog(b.id); };
    makeDraggable(li, b, li, true);
    li.append(a);
    return li;
  }));
}

// ------------------------------------------------------------ histórico (janela)

const historyDialog = $<HTMLDialogElement>('#history-dialog');
const historyQ = $<HTMLInputElement>('#history-q');

function openHistory(): void {
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
  historyQ.value = '';
  send({ type: 'history:view', open: true, query: '' });
  $('#history-list').replaceChildren();
  historyDialog.showModal();
  historyQ.focus();
}

function renderHistory(s: UiState): void {
  $('#history-btn').classList.toggle('on', historyDialog.open);
  if (!historyDialog.open || !s.historyView) return;
  const now = Date.now();
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  const onHome = Boolean(tab && isHomeUrl(tab.url) && !tab.live);
  const nodes: HTMLElement[] = [];
  let day = '';
  for (const h of s.historyView.entries) {
    const d = dayLabel(h.lastVisit, now);
    if (d !== day) { day = d; nodes.push(el('li', { className: 'day', textContent: d })); }
    const li = el('li', { className: 'entry', title: h.url });
    li.dataset.url = h.url;
    const del = el('button', { type: 'button', className: 'icon-btn', textContent: '✕', title: 'Apagar do histórico' });
    del.onclick = (e) => { e.stopPropagation(); send({ type: 'history:delete', url: h.url }); };
    li.append(el('span', { className: 'time', textContent: new Date(h.lastVisit).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }),
      el('span', { className: 't', textContent: h.title || readableUrl(h.url) }),
      el('span', { className: 'h', textContent: hostOf(h.url) }), del);
    li.onclick = (e) => {
      send(onHome && !(e.ctrlKey || e.metaKey) ? { type: 'tab:navigate', url: h.url } : { type: 'tab:new', url: h.url });
      historyDialog.close();
    };
    nodes.push(li);
  }
  $('#history-list').replaceChildren(...(nodes.length ? nodes
    : [el('li', { className: 'empty', textContent: s.historyView.query ? 'Nada encontrado.' : s.settings.historyOn ? 'Nenhuma página visitada ainda.' : 'O histórico está desligado (Configurações → Histórico).' })]));
}

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
historyQ.addEventListener('input', () => send({ type: 'history:view', open: true, query: historyQ.value.slice(0, 500) }));
historyDialog.addEventListener('close', () => { send({ type: 'history:view', open: false, query: '' }); $('#history-btn').classList.remove('on'); });
$('#history-btn').onclick = () => (historyDialog.open ? historyDialog.close() : openHistory());
let clearArmed: ReturnType<typeof setTimeout> | null = null;
$('#history-clear-all').onclick = () => {
  const b = $('#history-clear-all');
  if (!clearArmed) { // dois cliques: não apaga tudo sem querer
    b.textContent = 'Clique de novo para confirmar';
    clearArmed = setTimeout(() => { clearArmed = null; b.textContent = 'Apagar todo o histórico'; }, 3000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = null;
  b.textContent = 'Apagar todo o histórico';
  send({ type: 'history:clear' });
  send({ type: 'history:view', open: true, query: historyQ.value });
};

function renderPermissionPrompt(s: UiState): void {
  const bar = $('#permission-bar');
  const p = s.permissionPrompt;
  bar.hidden = !p;
  if (!p) return;
  bar.dataset.promptId = p.id;
  const host = new URL(p.origin).host;
  $('#permission-text').textContent = `${host} quer usar: ${p.kinds.map((k) => PERMISSION_LABELS[k]).join(', ')}`;
}

/** Select de 3 estados: herdar (mostrando o valor herdado) / bloquear / permitir. */
function triSelect(value: boolean | null, inherited: string, onChange: (v: boolean | null) => void): HTMLSelectElement {
  const select = el('select');
  for (const [v, label] of [['', `Padrão (${inherited})`], ['1', 'Bloquear'], ['0', 'Permitir']]) {
    select.appendChild(el('option', { value: v, textContent: label, selected: (value === null ? '' : value ? '1' : '0') === v }));
  }
  select.onchange = () => onChange(select.value === '' ? null : select.value === '1');
  return select;
}

function renderSiteBar(s: UiState): void {
  const info = s.sitePermissions;
  const p = s.sitePrivacy;

  // Engrenagem: permissões do site (menu nativo, como o escudo).
  const gear = $('#site-btn');
  gear.hidden = !info;
  if (info) {
    gear.classList.toggle('custom', hasCustomPermissions(info));
    gear.title = `Permissões em ${new URL(info.origin).host}`;
  }

  // Chave do Bitwarden: logins para este site.
  const key = $('#key-btn');
  const vs = s.vaultSite;
  key.hidden = !vs;
  if (vs) {
    key.className = `icon-btn ${vs.status}${vs.count ? ' has-logins' : ''}`;
    key.title = vs.status === 'locked' ? 'Bitwarden bloqueado — clique para desbloquear'
      : vs.count ? `${vs.count} login(s) para este site (Ctrl+Shift+L preenche)` : 'Nenhum login salvo para este site';
    const kc = $('#key-count');
    kc.hidden = vs.status !== 'unlocked' || vs.count === 0;
    kc.textContent = String(vs.count);
  }

  // Escudo na barra de endereço: estado da proteção no domínio + contador.
  const shield = $('#shield-btn');
  shield.hidden = !p;
  if (p) {
    shield.className = `icon-btn ${shieldState(p)}`;
    shield.title = `Proteção em ${p.site}: ${p.tabPaused ? 'pausada nesta aba'
      : `anúncios ${p.toggles.ads ? 'bloqueados' : 'liberados'}, rastreadores ${p.toggles.trackers ? 'bloqueados' : 'liberados'}`}`;
  }
  const total = p ? p.blocked.ads + p.blocked.trackers : 0;
  const badge = $('#blocked-count');
  badge.hidden = !p || total === 0 || p.tabPaused;
  badge.textContent = total > 99 ? '99+' : String(total);
}

function renderSavePrompt(s: UiState): void {
  const bar = $('#save-bar');
  const p = s.savePrompt;
  bar.hidden = !p;
  if (!p) return;
  bar.dataset.promptId = p.id;
  const who = p.username ? `de <b></b> ` : '';
  const text = $('#save-text');
  text.innerHTML = p.mode === 'update' ? `Atualizar a senha ${who}em <span></span> no Bitwarden?`
    : p.mode === 'locked' ? `Desbloqueie o Bitwarden para salvar a senha ${who}em <span></span>.`
    : `Salvar a senha ${who}em <span></span> no Bitwarden?`;
  // Textos vindos de fora (usuário/site) entram como texto, nunca como HTML.
  const b = text.querySelector('b');
  if (b) b.textContent = p.username;
  text.querySelector('span')!.textContent = p.site;
  $('#save-yes').textContent = p.mode === 'update' ? 'Atualizar' : p.mode === 'locked' ? 'Desbloquear…' : 'Salvar';
}

// ------------------------------------------------------------ versão nova / novidades

const updateDialog = $<HTMLDialogElement>('#update-dialog');
let shownNotice = '';

function renderUpdateNotice(s: UiState): void {
  const n = s.updateNotice;
  if (!n) { shownNotice = ''; if (updateDialog.open) updateDialog.close(); return; }
  const key = `${n.kind}:${n.version}`;
  if (key === shownNotice) return;
  shownNotice = key;
  const fresh = n.kind === 'available';
  $('#update-dialog-title').textContent = fresh ? `Apollo ${n.version} disponível` : `Novidades do Apollo ${n.version}`;
  const how = n.managedBy === 'aur' ? 'Atualize pelo seu gerenciador de pacotes (ex.: paru -Syu).'
    : n.canInstall ? 'A atualização baixa em segundo plano; suas abas voltam depois de reiniciar.' : 'Baixe a versão nova na página de lançamentos.';
  $('#update-dialog-sub').textContent = fresh
    ? `Você está na versão ${s.updateAbout.version}. ${how}`
    : 'O Apollo foi atualizado. O que mudou:';
  // Notas: só texto (textContent), agrupadas em listas.
  const nodes: HTMLElement[] = [];
  let list: HTMLElement | null = null;
  for (const b of n.notes) {
    if (b.type === 'item') {
      if (!list) { list = el('ul'); nodes.push(list); }
      list.append(el('li', { textContent: b.text }));
    } else {
      list = null;
      nodes.push(el(b.type === 'heading' ? 'h4' : 'p', { textContent: b.text }));
    }
  }
  $('#update-notes').replaceChildren(...(nodes.length ? nodes : [el('p', { textContent: 'Veja as mudanças na página da versão.' })]));
  $('#update-skip').hidden = !fresh;
  $('#update-dismiss').textContent = fresh ? 'Depois' : 'Fechar';
  const go = $<HTMLButtonElement>('#update-go');
  go.hidden = !fresh || n.managedBy === 'aur'; // AUR: o gerenciador de pacotes atualiza
  go.textContent = n.canInstall ? 'Baixar e instalar' : 'Abrir a página de download';
  go.dataset.action = n.canInstall ? 'install' : 'page';
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) if (d !== updateDialog) d.close();
  if (!updateDialog.open) updateDialog.showModal();
  (fresh ? go : $<HTMLButtonElement>('#update-dismiss')).focus(); // não a área das notas
}

$('#update-go').onclick = () => {
  if ($('#update-go').dataset.action === 'install') { updateDismissed = false; send({ type: 'update:download' }); send({ type: 'update:dismiss' }); }
  else send({ type: 'update:open-page' });
  updateDialog.close();
};
$('#update-skip').onclick = () => { send({ type: 'update:skip' }); updateDialog.close(); };
$('#update-dismiss').onclick = () => updateDialog.close();
// Fechar de qualquer jeito (Esc também) = "Depois".
updateDialog.addEventListener('close', () => { if (state?.updateNotice) send({ type: 'update:dismiss' }); });

function renderUpdate(s: UiState): void {
  const bar = $('#update-bar');
  const u = s.update;
  const primary = $<HTMLButtonElement>('#update-primary');
  // "Disponível" é mostrado na janela de versão nova (com as notas); a barra só acompanha
  // o download e o "reiniciar".
  if (!u || u.stage === 'available' || updateDismissed) { bar.hidden = true; return; }
  bar.hidden = false;
  primary.hidden = u.stage === 'downloading' || u.stage === 'error';
  primary.disabled = false;
  if (u.stage === 'downloading') {
    $('#update-text').textContent = `Baixando atualização… ${u.percent}%`;
  } else if (u.stage === 'downloaded') {
    $('#update-text').textContent = `Apollo ${u.version} pronto. Suas abas serão restauradas.`;
    primary.textContent = 'Reiniciar agora';
    primary.dataset.action = 'install';
  } else {
    $('#update-text').textContent = 'Não foi possível atualizar agora. Tentaremos de novo mais tarde.';
  }
}

// ------------------------------------------------------------ layout da página

// O main desenha a página da aba ativa por cima de #views; mandamos a posição exata.
const views = $('#views');
const sendBounds = () => {
  const r = views.getBoundingClientRect();
  send({ type: 'layout:bounds', x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
};
new ResizeObserver(sendBounds).observe(views);
window.addEventListener('resize', sendBounds);

// ------------------------------------------------------------ diálogo de workspace

const dialog = $<HTMLDialogElement>('#ws-dialog');
let editing: WorkspaceInfo | null = null;

const hibernateLabel = (m: number) => (m === -1 ? 'Ao sair da aba' : m === 0 ? 'Nunca' : m < 60 ? `${m} minutos` : m === 60 ? '1 hora' : `${m / 60} horas`);
$('#ws-hibernate').replaceChildren(...HIBERNATE_OPTIONS_MIN.map((m) => el('option', { value: String(m), textContent: hibernateLabel(m) })));
const hiddenLabel = (m: number | null) => (m === null ? 'Mesma regra de cima' : m === -1 ? 'Ao sair do workspace' : `Após ${hibernateLabel(m)}`);
$('#ws-hidden-hibernate').replaceChildren(...HIDDEN_HIBERNATE_OPTIONS_MIN.map((m) =>
  el('option', { value: m === null ? '' : String(m), textContent: hiddenLabel(m) })));

// --- ícone do workspace (emoji)

const WS_ICONS = ['🏠', '💼', '🎓', '🏦', '💻', '🎮', '🛒', '✈️', '🎵', '📚', '❤️', '⭐', '🔬', '🏥', '📷', '🧪', '☀️', '🐱', '⚽', '💰'];
const wsIconInput = $<HTMLInputElement>('#ws-icon');
function markIcon(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#ws-icon-grid button')) b.classList.toggle('selected', b.textContent === wsIconInput.value);
}
$('#ws-icon-grid').replaceChildren(...WS_ICONS.map((icon) => {
  const b = el('button', { type: 'button', textContent: icon, title: icon });
  b.setAttribute('role', 'radio');
  b.onclick = () => { wsIconInput.value = icon; markIcon(); };
  return b;
}));
wsIconInput.addEventListener('input', markIcon);
$('#ws-icon-none').onclick = () => { wsIconInput.value = ''; markIcon(); };
/** Só o primeiro "caractere visível" (um emoji pode ter vários códigos). */
const firstGrapheme = (s: string) => {
  const first = [...new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(s.trim())][0]?.segment ?? '';
  return first && !/[<>&"'\s]/.test(first) ? first : '';
};

function openWorkspaceDialog(ws: WorkspaceInfo | null = null): void {
  editing = ws;
  $('#ws-dialog-title').textContent = ws ? 'Editar workspace' : 'Novo workspace';
  $<HTMLInputElement>('#ws-name').value = ws?.name ?? '';
  $<HTMLInputElement>('#ws-color').value = ws?.color ?? '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  $<HTMLInputElement>('#ws-home').value = ws && !isHomeUrl(ws.home) ? ws.home : '';
  wsIconInput.value = ws?.icon ?? '';
  markIcon();
  $<HTMLSelectElement>('#ws-hibernate').value = String(ws?.hibernateAfterMin ?? 30);
  const hidden = ws ? ws.hiddenHibernateMin : 10;
  $<HTMLSelectElement>('#ws-hidden-hibernate').value = hidden === null ? '' : String(hidden);
  // Temporário só se escolhe ao criar.
  $('#ws-temporary-row').hidden = Boolean(ws);
  $<HTMLInputElement>('#ws-temporary').checked = false;
  // Padrões de privacidade do workspace (só ao editar: o novo herda o global).
  $('#ws-privacy').replaceChildren(...(ws ? (Object.keys(PRIVACY_LABELS) as PrivacyFeature[]).map((feature) => {
    const label = el('label', { textContent: PRIVACY_LABELS[feature] });
    label.appendChild(triSelect(ws.privacy[feature], 'global', (enabled) =>
      send({ type: 'privacy:set', scope: 'workspace', workspaceId: ws.id, feature, enabled })));
    return label;
  }) : []));
  $('#ws-delete').hidden = !ws || (state?.workspaces.length ?? 0) <= 1;
  dialog.showModal();
  $('#ws-name').focus();
}


$('#ws-form').addEventListener('submit', () => {
  const name = $<HTMLInputElement>('#ws-name').value.trim();
  const color = $<HTMLInputElement>('#ws-color').value;
  const home = normalizeUrl($<HTMLInputElement>('#ws-home').value) ?? '';
  const hibernateAfterMin = Number($<HTMLSelectElement>('#ws-hibernate').value);
  const hiddenRaw = $<HTMLSelectElement>('#ws-hidden-hibernate').value;
  const hiddenHibernateMin = hiddenRaw === '' ? null : Number(hiddenRaw);
  const icon = firstGrapheme(wsIconInput.value) || null;
  if (!name) return;
  if (editing) send({ type: 'workspace:update', workspaceId: editing.id, name, color, home, hibernateAfterMin, hiddenHibernateMin, icon });
  else send({ type: 'workspace:create', name, color, home, hibernateAfterMin, hiddenHibernateMin, temporary: $<HTMLInputElement>('#ws-temporary').checked, icon });
});

$('#ws-cancel').onclick = () => dialog.close();

$('#ws-delete').onclick = () => {
  const btn = $<HTMLButtonElement>('#ws-delete');
  if (!editing) return;
  // Confirmação em dois cliques (window.confirm não é confiável no Electron).
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = 'Clique de novo para confirmar (apaga logins)';
    setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Excluir workspace'; }, 4000);
    return;
  }
  btn.dataset.armed = '';
  btn.textContent = 'Excluir workspace';
  send({ type: 'workspace:delete', workspaceId: editing.id });
  dialog.close();
};

// ------------------------------------------------------------ configurações

const settingsPage = $('#settings-page');
type SettingsSection = 'privacy' | 'dns' | 'history' | 'downloads' | 'bookmarks' | 'media' | 'languages' | 'sync' | 'vault' | 'modules' | 'about';
const SETTINGS_SECTIONS: SettingsSection[] = ['privacy', 'dns', 'history', 'downloads', 'bookmarks', 'media', 'languages', 'sync', 'vault', 'modules', 'about'];
let settingsSection: SettingsSection = 'privacy';
/** Aba ativa quando a página abriu: trocar de aba fecha as configurações. */
let settingsTabId: string | null = null;
const settingsOpen = () => !settingsPage.hidden;

function showSettingsSection(section: SettingsSection): void {
  settingsSection = section;
  try { localStorage.setItem('settings-section', section); } catch { /* sem armazenamento: tudo bem */ }
  for (const b of document.querySelectorAll<HTMLElement>('#settings-nav button')) b.classList.toggle('active', b.dataset.section === section);
  for (const d of document.querySelectorAll<HTMLElement>('.settings-section')) d.hidden = d.dataset.section !== section;
  if (section === 'modules') showModulesView(false);
  $('#settings-body').scrollTop = 0;
  if (state) { renderSettings(state); renderModules(state); }
}

function openSettings(section?: SettingsSection): void {
  if (!state) return;
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
  $<HTMLSelectElement>('#dns-mode').value = state.settings.dns.mode;
  $<HTMLInputElement>('#dns-url').value = state.settings.dns.dohUrl ?? '';
  let saved: string | null = null;
  try { saved = localStorage.getItem('settings-section'); } catch { /* sem armazenamento */ }
  settingsTabId = state.activeTabId;
  settingsPage.hidden = false;
  syncOverlay();
  showSettingsSection(section ?? (SETTINGS_SECTIONS.includes(saved as SettingsSection) ? saved as SettingsSection : 'privacy'));
  $<HTMLElement>(`#settings-nav button[data-section="${settingsSection}"]`).focus();
}

function closeSettings(): void {
  if (!settingsOpen()) return;
  settingsPage.hidden = true;
  syncOverlay();
  send({ type: 'tab:focus' });
}

for (const b of document.querySelectorAll<HTMLElement>('#settings-nav button')) {
  b.onclick = () => showSettingsSection(b.dataset.section as SettingsSection);
}
$('#settings-close').onclick = closeSettings;
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsOpen() && !document.querySelector('dialog[open]')) { e.preventDefault(); closeSettings(); }
});
$('#settings-open-history').onclick = () => openHistory();
$('#settings-manage-bookmarks').onclick = () => openBookmarkManager();
$('#settings-open-vault').onclick = () => openVault();
$<HTMLInputElement>('#settings-bookmark-bar').onchange = (e) => send({ type: 'settings:bookmark-bar', show: (e.target as HTMLInputElement).checked });
$('#about-check').onclick = () => send({ type: 'update:check' });
$('#default-set').onclick = () => send({ type: 'default-browser:set' });

// --- sincronização

const SYNC_HELP = {
  google: 'Crie em console.cloud.google.com: um projeto, ative a "Google Drive API", e em Credenciais crie um "ID do cliente OAuth" do tipo "App para computador". Passo a passo em docs/SYNC.md.',
  onedrive: 'Crie em portal.azure.com → Registros de aplicativo: contas pessoais e corporativas, plataforma "Aplicativos móveis e de desktop" com o endereço http://localhost, e a permissão Files.ReadWrite.AppFolder. Passo a passo em docs/SYNC.md.',
};
function renderSync(s: UiState): void {
  const y = s.settings.sync;
  const connected = y.status === 'ok' || y.status === 'syncing' || (y.status === 'error' && y.provider !== null);
  $('#sync-connected').hidden = !connected;
  $('#sync-connecting').hidden = y.status !== 'connecting';
  $('#sync-form').hidden = connected || y.status === 'connecting';
  const name = y.provider === 'google' ? 'Google Drive' : y.provider === 'onedrive' ? 'OneDrive' : '';
  const when = y.lastSync ? `${dayLabel(y.lastSync, Date.now()).toLowerCase()} às ${new Date(y.lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'ainda não';
  const status = $('#sync-status');
  status.className = y.status === 'error' ? 'error' : 'hint';
  status.textContent = y.status === 'syncing' ? `Sincronizando com o ${name}…`
    : y.status === 'connecting' ? 'Esperando o login…'
    : connected ? `${y.error ? `${y.error} ` : ''}Conectado ao ${name}. Última sincronização: ${when}.${y.remembered ? '' : ' Sem chaveiro do sistema: será preciso conectar de novo a cada abertura.'}`
    : y.error ? `Não conectou: ${y.error}` : 'Desligada.';
  $<HTMLButtonElement>('#sync-now').disabled = y.status === 'syncing';
  const provider = $<HTMLSelectElement>('#sync-provider').value as 'google' | 'onedrive';
  $('#sync-secret-row').hidden = provider !== 'google';
  $('#sync-app-help').textContent = SYNC_HELP[provider];
}
$<HTMLSelectElement>('#sync-provider').onchange = () => state && renderSync(state);
$('#sync-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('#sync-form-error');
  const pass = $<HTMLInputElement>('#sync-pass').value;
  const provider = $<HTMLSelectElement>('#sync-provider').value as 'google' | 'onedrive';
  const secret = $<HTMLInputElement>('#sync-client-secret').value.trim();
  const problem = pass.length < 8 ? 'A senha precisa de pelo menos 8 caracteres.'
    : pass !== $<HTMLInputElement>('#sync-pass2').value ? 'As senhas não conferem.'
    : provider === 'google' && !secret ? 'O Google pede também a chave do aplicativo (Client secret).' : '';
  err.hidden = !problem;
  err.textContent = problem;
  if (problem) return;
  send({ type: 'sync:connect', provider, clientId: $<HTMLInputElement>('#sync-client-id').value.trim(),
    clientSecret: provider === 'google' ? secret : null, passphrase: pass });
  $<HTMLInputElement>('#sync-pass').value = '';
  $<HTMLInputElement>('#sync-pass2').value = '';
});
$('#sync-now').onclick = () => send({ type: 'sync:now' });
$('#sync-cancel').onclick = () => send({ type: 'sync:cancel' });
$('#sync-disconnect').onclick = () => send({ type: 'sync:disconnect' });
$<HTMLSelectElement>('#vault-match').onchange = (e) => send({ type: 'settings:vault-match', match: (e.target as HTMLSelectElement).value === '0' ? 0 : 1 });
$<HTMLInputElement>('#google-compat').onchange = (e) => send({ type: 'settings:google-compat', on: (e.target as HTMLInputElement).checked });
$<HTMLInputElement>('#pip-on-top').onchange = (e) => send({ type: 'settings:pip-on-top', on: (e.target as HTMLInputElement).checked });
$<HTMLInputElement>('#auto-pip').onchange = (e) => send({ type: 'settings:auto-pip', on: (e.target as HTMLInputElement).checked });

function renderSettings(s: UiState): void {
  if (!settingsOpen()) return;
  if (s.activeTabId !== settingsTabId) { closeSettings(); return; } // foi para outra aba
  $<HTMLInputElement>('#settings-bookmark-bar').checked = s.settings.bookmarkBar;
  $<HTMLInputElement>('#auto-pip').checked = s.settings.autoPip;
  $<HTMLInputElement>('#pip-on-top').checked = s.settings.pipOnTop;
  $<HTMLInputElement>('#google-compat').checked = s.settings.googleCompat;
  $<HTMLSelectElement>('#vault-match').value = s.settings.vaultMatch === 'domain' ? '0' : '1';
  renderSync(s);
  $('#settings-vault-status').textContent = s.vault.status === 'unlocked' ? 'Cofre conectado e desbloqueado.'
    : s.vault.status === 'locked' ? 'Cofre conectado e bloqueado.' : 'Nenhum cofre conectado. Funciona com o Bitwarden oficial ou um servidor próprio (Vaultwarden).';
  const a = s.updateAbout;
  $('#about-version').textContent = `Apollo ${a.version}`;
  $('#about-status').textContent = !a.enabled ? 'Verificação de versões desligada nesta cópia (desenvolvimento).'
    : a.checking ? 'Verificando…'
    : a.failed ? 'Não foi possível verificar agora (sem conexão?).'
    : a.latest && compareVersions(a.latest, a.version) > 0 ? `Versão ${a.latest} disponível.`
    : a.checked ? `Você está na versão mais recente (verificado às ${new Date(a.checked).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}).`
    : 'Verificação automática a cada 6 horas.';
  $<HTMLButtonElement>('#about-check').disabled = !a.enabled || a.checking;
  const d = s.settings.defaultBrowser;
  $('#default-status').textContent = d === true ? 'O Apollo é o seu navegador padrão: links de outros programas abrem aqui.'
    : d === false ? 'Outro navegador é o padrão hoje.' : 'Links de outros programas abrem no navegador escolhido pelo sistema.';
  $('#default-set').hidden = d === true;
  $<HTMLInputElement>('#download-ask').checked = s.settings.downloadAsk;
  const dd = $<HTMLSelectElement>('#download-days');
  if (document.activeElement !== dd) dd.value = String(s.settings.downloadKeepDays);
  $<HTMLInputElement>('#history-on').checked = s.settings.historyOn;
  const sc = $<HTMLSelectElement>('#spellcheck');
  if (document.activeElement !== sc) sc.value = s.settings.spellcheck;
  const t = s.settings.dnsTest;
  const status = $('#dns-status');
  status.className = t.status === 'ok' ? 'ok' : t.status === 'fail' ? 'fail' : '';
  status.textContent = t.status === 'testing' ? 'Testando…'
    : t.status === 'ok' ? `Funcionando (${t.ms} ms) — ${s.settings.dns.provider ?? ''}`
    : t.status === 'fail' ? `Falhou: ${t.error}` : `Em uso: ${s.settings.dns.mode === 'off' ? 'DNS do sistema' : s.settings.dns.provider ?? ''}`;

  $('#global-privacy').replaceChildren(...(Object.keys(PRIVACY_LABELS) as PrivacyFeature[]).map((feature) => {
    const label = el('label', { textContent: PRIVACY_LABELS[feature] });
    const select = el('select');
    const value = s.settings.privacy[feature];
    for (const [v, text] of [['', 'Padrão do Apollo (ligado)'], ['1', 'Ligado'], ['0', 'Desligado']]) {
      select.appendChild(el('option', { value: v, textContent: text, selected: (value === null ? '' : value ? '1' : '0') === v }));
    }
    select.onchange = () => send({ type: 'privacy:set', scope: 'global', feature, enabled: select.value === '' ? null : select.value === '1' });
    label.appendChild(select);
    return label;
  }));
}

$('#settings-btn').onclick = () => (settingsOpen() ? closeSettings() : openSettings());
$<HTMLInputElement>('#history-on').onchange = (e) => send({ type: 'settings:history', on: (e.target as HTMLInputElement).checked });
$('#history-clear').onclick = () => {
  send({ type: 'history:clear' });
  $('#history-clear').textContent = 'Histórico apagado';
  setTimeout(() => { $('#history-clear').textContent = 'Apagar todo o histórico'; }, 2500);
};
$<HTMLSelectElement>('#download-days').onchange = (e) => send({ type: 'settings:download-days', days: Number((e.target as HTMLSelectElement).value) });
$<HTMLInputElement>('#download-ask').onchange = (e) => send({ type: 'settings:download-ask', ask: (e.target as HTMLInputElement).checked });
$<HTMLSelectElement>('#spellcheck').onchange = (e) =>
  send({ type: 'settings:spellcheck', mode: (e.target as HTMLSelectElement).value as SpellcheckMode });
$('#dns-save').onclick = () => {
  const url = $<HTMLInputElement>('#dns-url').value.trim();
  if (url && !/^https:\/\/[^\s]+$/.test(url)) {
    $('#dns-status').className = 'fail';
    $('#dns-status').textContent = 'O endereço precisa começar com https://';
    return;
  }
  send({ type: 'settings:dns', mode: $<HTMLSelectElement>('#dns-mode').value as DnsMode, dohUrl: url || null });
};
$('#dns-test').onclick = () => send({ type: 'settings:test-dns' });

// ------------------------------------------------------------ cofre (Bitwarden)

const vaultDialog = $<HTMLDialogElement>('#vault-dialog');
const LOCK_LABELS: [number, string][] = [[1, '1 minuto'], [5, '5 minutos'], [15, '15 minutos'], [30, '30 minutos'], [60, '1 hora'], [240, '4 horas']];
$('#vault-lock-after').replaceChildren(...LOCK_LABELS.map(([m, t]) => el('option', { value: String(m), textContent: t })));

/** Senhas e segredos saem dos campos assim que enviados. */
const takeSecret = (sel: string) => { const i = $<HTMLInputElement>(sel); const v = i.value; i.value = ''; return v; };

function renderVault(s: UiState): void {
  const v = s.vault;
  $('#vault-btn').classList.toggle('unlocked', v.status === 'unlocked');
  $('#vault-btn').title = v.status === 'unlocked' ? `Bitwarden: desbloqueado (${v.count} logins)`
    : v.status === 'locked' ? 'Bitwarden: bloqueado' : 'Bitwarden: conectar';
  if (!vaultDialog.open) return;

  $('#vault-connect').hidden = v.status !== 'disconnected';
  $('#vault-locked').hidden = v.status !== 'locked';
  $('#vault-unlocked').hidden = v.status !== 'unlocked';
  $('#vault-no-keyring').hidden = v.canRemember;
  $('#vault-account').textContent = `${v.email} — ${v.server}`;
  const sync = v.lastSync ? new Date(v.lastSync).toLocaleString('pt-BR') : 'nunca';
  $('#vault-summary').textContent = `${v.email} — ${v.server}: ${v.count} logins. Última sincronização: ${sync}.`;
  const lock = $<HTMLSelectElement>('#vault-lock-after');
  if (document.activeElement !== lock) lock.value = String(v.lockAfterMin);
  $<HTMLSelectElement>('#gen-length').value = String(s.generator.length);
  $<HTMLInputElement>('#gen-symbols').checked = s.generator.symbols;

  const err = $('#vault-error');
  err.hidden = !v.error;
  err.textContent = v.error ?? '';
  $('#vault-disconnect').hidden = v.status === 'disconnected';
  const primary = $<HTMLButtonElement>('#vault-primary');
  const secondary = $<HTMLButtonElement>('#vault-secondary');
  primary.disabled = v.busy;
  secondary.disabled = v.busy;
  primary.textContent = v.busy ? 'Aguarde…' : v.status === 'disconnected' ? 'Conectar' : v.status === 'locked' ? 'Desbloquear' : 'Bloquear';
  secondary.hidden = v.status !== 'unlocked';
  secondary.textContent = 'Sincronizar';
}

function openVault(): void {
  if (!state) return;
  vaultDialog.showModal();
  renderVault(state);
  const focus = state.vault.status === 'locked' ? '#vault-password' : state.vault.status === 'disconnected' ? '#vault-client-id' : null;
  if (focus) $(focus).focus();
}

$('#vault-btn').onclick = openVault;
$('#gen-length').replaceChildren(...GENERATOR_LENGTHS.map((n) => el('option', { value: String(n), textContent: `${n} caracteres` })));
const sendGenerator = () => send({ type: 'vault:generator', length: Number($<HTMLSelectElement>('#gen-length').value),
  symbols: $<HTMLInputElement>('#gen-symbols').checked });
$<HTMLSelectElement>('#gen-length').onchange = sendGenerator;
$<HTMLInputElement>('#gen-symbols').onchange = sendGenerator;
const answerSave = (action: 'save' | 'dismiss' | 'never') => {
  const promptId = $('#save-bar').dataset.promptId;
  if (promptId) send({ type: 'vault:save-answer', promptId, action });
};
$('#save-yes').onclick = () => {
  if (state?.savePrompt?.mode === 'locked') openVault(); // depois de desbloquear, a barra vira "Salvar"
  else answerSave('save');
};
$('#save-no').onclick = () => answerSave('dismiss');
$('#save-never').onclick = () => answerSave('never');
vaultDialog.addEventListener('close', () => {
  for (const sel of ['#vault-client-secret', '#vault-connect-password', '#vault-password']) $<HTMLInputElement>(sel).value = '';
});
$('#vault-close').onclick = () => vaultDialog.close();
$<HTMLSelectElement>('#vault-server').onchange = (e) => {
  $('#vault-custom-row').hidden = (e.target as HTMLSelectElement).value !== 'custom';
};
$<HTMLSelectElement>('#vault-lock-after').onchange = (e) =>
  send({ type: 'vault:lock-after', minutes: Number((e.target as HTMLSelectElement).value) });
$('#vault-secondary').onclick = () => send({ type: 'vault:sync' });
$('#vault-disconnect').onclick = () => {
  const btn = $<HTMLButtonElement>('#vault-disconnect');
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = 'Clique de novo: esquece a conta neste computador';
    setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Desconectar'; }, 4000);
    return;
  }
  btn.dataset.armed = '';
  btn.textContent = 'Desconectar';
  send({ type: 'vault:disconnect' });
};
$('#vault-form').addEventListener('submit', (e) => {
  e.preventDefault(); // o diálogo continua aberto: o resultado chega pelo estado
  const v = state?.vault;
  if (!v || v.busy) return;
  if (v.status === 'disconnected') {
    const choice = $<HTMLSelectElement>('#vault-server').value;
    const server = choice === 'custom' ? $<HTMLInputElement>('#vault-custom').value.trim() : choice;
    send({ type: 'vault:connect', server, clientId: $<HTMLInputElement>('#vault-client-id').value.trim(),
      clientSecret: takeSecret('#vault-client-secret'), password: takeSecret('#vault-connect-password') });
  } else if (v.status === 'locked') {
    send({ type: 'vault:unlock', password: takeSecret('#vault-password') });
  } else {
    send({ type: 'vault:lock' });
  }
});

// ------------------------------------------------------------ painéis laterais

const panelEls = new Map<string, HTMLElement>();
const panelArea = $('#panel-area');

function renderPanels(s: UiState): void {
  const wsColor = new Map(s.workspaces.map((w) => [w.id, w.color]));
  const wsName = new Map(s.workspaces.map((w) => [w.id, w.name]));
  reconcile($('#panel-list'), panelEls, s.panels, (p) => p.id, (p) => {
    const b = el('button', { className: 'rail-btn' });
    b.dataset.panelId = p.id;
    b.onclick = () => send({ type: 'panel:toggle', panelId: p.id });
    b.oncontextmenu = (e) => { e.preventDefault(); send({ type: 'panel:menu', panelId: p.id, x: e.clientX, y: e.clientY }); };
    return b;
  }, (b, p) => {
    b.classList.toggle('active', p.id === s.activePanelId);
    b.classList.toggle('sleeping', !p.loaded);
    b.title = `${p.title || p.url}\nLogins do workspace ${wsName.get(p.workspaceId) ?? ''}\nBotão direito: opções`;
    const letter = (p.title || new URL(p.url).hostname.replace(/^www\./, '')).charAt(0).toUpperCase();
    const img = b.querySelector('img');
    if (p.favicon) {
      if (!img || img.getAttribute('src') !== p.favicon) {
        const i = el('img', { src: p.favicon, alt: '' });
        i.onerror = () => { i.remove(); b.prepend(letter); };
        b.replaceChildren(i);
      }
    } else if (img || !b.firstChild || b.firstChild.nodeType !== Node.TEXT_NODE) {
      b.replaceChildren(letter);
    }
    let dot = b.querySelector<HTMLElement>('.ws-dot');
    if (!dot) { dot = el('span', { className: 'ws-dot' }); b.appendChild(dot); }
    dot.style.background = wsColor.get(p.workspaceId) ?? 'transparent';
  });
  const active = s.panels.find((p) => p.id === s.activePanelId);
  panelArea.hidden = !active;
  $('#panel-resizer').hidden = !active;
  if (active && !resizing) panelArea.style.width = `${active.width}px`;
}

// Arrastar a borda: largura ao vivo (o main acompanha pelo ResizeObserver) e salva ao soltar.
let resizing: { id: string; startX: number; startWidth: number } | null = null;
const resizer = $('#panel-resizer');
const clampWidth = (w: number) => Math.round(Math.min(Math.max(w, PANEL_MIN_WIDTH),
  Math.min(PANEL_MAX_WIDTH, window.innerWidth - 300)));
resizer.addEventListener('pointerdown', (e) => {
  if (!state?.activePanelId) return;
  e.preventDefault();
  resizer.setPointerCapture(e.pointerId); // continua recebendo o mouse mesmo sobre a página
  resizer.classList.add('dragging');
  resizing = { id: state.activePanelId, startX: e.clientX, startWidth: panelArea.getBoundingClientRect().width };
});
resizer.addEventListener('pointermove', (e) => {
  if (!resizing) return;
  panelArea.style.width = `${clampWidth(resizing.startWidth + (resizing.startX - e.clientX))}px`;
});
const endResize = (e: PointerEvent) => {
  if (!resizing) return;
  const { id } = resizing;
  resizing = null;
  resizer.classList.remove('dragging');
  if (resizer.hasPointerCapture(e.pointerId)) resizer.releasePointerCapture(e.pointerId);
  send({ type: 'panel:set', panelId: id, width: clampWidth(panelArea.getBoundingClientRect().width) });
};
resizer.addEventListener('pointerup', endResize);
resizer.addEventListener('pointercancel', endResize);
resizer.addEventListener('dblclick', () => {
  if (state?.activePanelId) send({ type: 'panel:set', panelId: state.activePanelId, width: PANEL_DEFAULT_WIDTH });
});

const sendPanelBounds = () => {
  const r = panelArea.getBoundingClientRect();
  send({ type: 'panel:bounds', x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
};
new ResizeObserver(sendPanelBounds).observe(panelArea);

const panelDialog = $<HTMLDialogElement>('#panel-dialog');
$('#panel-suggestions').replaceChildren(...PANEL_SUGGESTIONS.map((sug) => {
  const b = el('button', { type: 'button', textContent: sug.name });
  b.onclick = () => {
    $<HTMLInputElement>('#panel-url').value = sug.url;
    $<HTMLInputElement>('#panel-mobile').checked = Boolean(sug.mobile);
  };
  return b;
}));
$('#panel-add').onclick = () => {
  if (!state) return;
  $('#panel-ws').replaceChildren(...state.workspaces.map((w) => el('option', { value: w.id, textContent: w.name, selected: w.id === state!.activeWorkspaceId })));
  $<HTMLInputElement>('#panel-url').value = '';
  $<HTMLInputElement>('#panel-mobile').checked = false;
  panelDialog.showModal();
  $('#panel-url').focus();
};
$('#panel-cancel').onclick = () => panelDialog.close();
$('#panel-form').addEventListener('submit', (e) => {
  const raw = $<HTMLInputElement>('#panel-url').value.trim();
  const url = normalizeUrl(raw);
  if (!url || !/^https?:\/\//.test(url) || url.startsWith(SEARCH_URL)) {
    e.preventDefault(); // continua aberto: precisa de um endereço
    $('#panel-url').focus();
    return;
  }
  send({ type: 'panel:add', url, workspaceId: $<HTMLSelectElement>('#panel-ws').value, mobile: $<HTMLInputElement>('#panel-mobile').checked });
});

// ------------------------------------------------------------ módulos e personalizações

let editingCustom: string | null = null; // id em edição (null = nova)

function renderModules(s: UiState): void {
  if (!settingsOpen() || settingsSection !== 'modules') return;
  $('#modules-list').replaceChildren(...s.modules.map((m) => {
    const label = el('label', { className: 'module-row' });
    const cb = el('input', { type: 'checkbox', checked: m.enabled });
    cb.dataset.moduleId = m.id;
    cb.onchange = () => send({ type: 'module:set', moduleId: m.id, enabled: cb.checked });
    const text = el('span');
    text.append(el('b', { textContent: m.name }), el('small', { textContent: m.description }));
    label.append(cb, text);
    return label;
  }));
  $('#custom-list').replaceChildren(...(s.customizations.length ? s.customizations.map((c) => {
    const li = el('li', { className: c.enabled ? '' : 'off' });
    li.dataset.customId = c.id;
    li.append(el('b', { textContent: c.name }), el('span', { className: 'sites', textContent: c.sites }),
      el('small', { textContent: [c.css.trim() && 'CSS', c.js.trim() && 'JS'].filter(Boolean).join(' + ') || 'vazia' }));
    li.onclick = () => openCustomEditor(c.id);
    return li;
  }) : [el('li', { className: 'off', textContent: 'Nenhuma personalização ainda.' })]));
}

function showModulesView(editor: boolean): void {
  $('#modules-main').hidden = editor;
  $('#custom-editor').hidden = !editor;
}

function openModules(): void {
  openSettings('modules');
}

function openCustomEditor(id: string | null): void {
  const c = id ? state?.customizations.find((x) => x.id === id) : null;
  editingCustom = c?.id ?? null;
  $('#custom-title').textContent = c ? 'Editar personalização' : 'Nova personalização';
  $<HTMLInputElement>('#custom-name').value = c?.name ?? '';
  $<HTMLInputElement>('#custom-sites').value = c?.sites ?? (state?.sitePrivacy?.site ?? '');
  $<HTMLTextAreaElement>('#custom-css').value = c?.css ?? '';
  $<HTMLTextAreaElement>('#custom-js').value = c?.js ?? '';
  $<HTMLInputElement>('#custom-enabled').checked = c?.enabled ?? true;
  $('#custom-delete').hidden = !c;
  showModulesView(true);
  $('#custom-name').focus();
}

$('#custom-new').onclick = () => openCustomEditor(null);
$('#custom-cancel').onclick = () => showModulesView(false);
$('#custom-save').onclick = () => {
  const name = $<HTMLInputElement>('#custom-name').value.trim();
  const sites = $<HTMLInputElement>('#custom-sites').value.trim();
  if (!name || !sites) { $(name ? '#custom-sites' : '#custom-name').focus(); return; }
  send({ type: 'custom:save', ...(editingCustom ? { id: editingCustom } : {}), name, sites,
    css: $<HTMLTextAreaElement>('#custom-css').value, js: $<HTMLTextAreaElement>('#custom-js').value,
    enabled: $<HTMLInputElement>('#custom-enabled').checked });
  showModulesView(false);
};
$('#custom-delete').onclick = () => {
  if (editingCustom) send({ type: 'custom:delete', id: editingCustom });
  showModulesView(false);
};

// ------------------------------------------------------------ compartilhar tela

const screenDialog = $<HTMLDialogElement>('#screen-dialog');
let screenRequestId: string | null = null;
let screenSelected: string | null = null;

const SCREEN_GROUPS: [ScreenSource['kind'], string][] = [
  ['system', 'Tela ou janela'], ['screen', 'Tela inteira'], ['window', 'Janela'], ['tab', 'Aba do Apollo'],
];

function renderScreenPicker(s: UiState): void {
  const p = s.screenPicker;
  if (!p) {
    if (screenDialog.open) { screenRequestId = null; screenDialog.close(); }
    return;
  }
  if (screenRequestId === p.id) return; // já desenhado
  screenRequestId = p.id;
  screenSelected = null;
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) if (d !== screenDialog) d.close();
  $('#screen-origin').textContent = `${new URL(p.origin).host} quer ver o que você escolher.`;
  const select = (id: string, btn: HTMLElement) => {
    screenSelected = id;
    for (const b of document.querySelectorAll('.screen-src.selected')) b.classList.remove('selected');
    btn.classList.add('selected');
    $<HTMLButtonElement>('#screen-share').disabled = false;
    // Áudio: da aba (qualquer sistema) ou do computador (só Windows).
    const kind = p.sources.find((x) => x.id === id)!.kind;
    const audioOk = p.audioRequested && (kind === 'tab' || (p.systemAudio && kind !== 'system'));
    $('#screen-audio-row').hidden = !audioOk;
    $('#screen-audio-label').textContent = kind === 'tab' ? 'Compartilhar o áudio da aba' : 'Compartilhar o som do computador';
  };
  $('#screen-sources').replaceChildren(...SCREEN_GROUPS.flatMap(([kind, title]) => {
    const items = p.sources.filter((x) => x.kind === kind);
    if (!items.length) return [];
    const grid = el('div', { className: 'grid' });
    grid.append(...items.map((src) => {
      const b = el('button', { type: 'button', className: 'screen-src' });
      b.dataset.sourceId = src.id;
      b.append(src.thumbnail ? el('img', { src: src.thumbnail, alt: '' }) : el('div', { className: 'nothumb', textContent: kind === 'system' ? '🖥' : '▢' }),
        el('span', { textContent: src.name, title: src.name }));
      b.onclick = () => select(src.id, b);
      b.ondblclick = () => { select(src.id, b); $<HTMLFormElement>('#screen-form').requestSubmit(); };
      return b;
    }));
    const section = el('section');
    section.append(el('h3', { textContent: title }), grid);
    return [section];
  }));
  $('#screen-audio-row').hidden = true;
  $<HTMLInputElement>('#screen-audio').checked = false;
  $<HTMLButtonElement>('#screen-share').disabled = true;
  if (!screenDialog.open) screenDialog.showModal();
}

const answerScreen = (sourceId: string | null) => {
  const id = screenRequestId;
  screenRequestId = null;
  if (id) send({ type: 'screen:pick', requestId: id, sourceId, audio: $<HTMLInputElement>('#screen-audio').checked });
};
$('#screen-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!screenSelected) return;
  answerScreen(screenSelected);
  screenDialog.close();
});
$('#screen-cancel').onclick = () => screenDialog.close();
// Fechar de qualquer jeito (Esc, Cancelar) sem escolher = negar.
screenDialog.addEventListener('close', () => { if (screenRequestId) answerScreen(null); });

// ------------------------------------------------------------ paleta de comandos (Ctrl+K)

const palette = $<HTMLDialogElement>('#palette');
const paletteInput = $<HTMLInputElement>('#palette-input');
let paletteItems: PaletteItem[] = [];
let paletteSel = 0;

function renderPalette(): void {
  if (!palette.open || !state) return;
  const query = paletteInput.value;
  paletteItems = buildItems({ state, query, openUrl: query.trim() ? normalizeUrl(query) : null });
  paletteSel = Math.min(paletteSel, Math.max(0, paletteItems.length - 1));
  const list = $('#palette-list');
  const nodes: HTMLElement[] = [];
  let group = '';
  paletteItems.forEach((it, i) => {
    if (it.group !== group) { group = it.group; nodes.push(el('li', { className: 'group', textContent: group })); }
    const li = el('li', { className: `item${i === paletteSel ? ' selected' : ''}` });
    li.setAttribute('role', 'option');
    li.dataset.index = String(i);
    li.append(el('span', { className: 'title', textContent: it.title }), el('span', { className: 'detail', textContent: it.detail }));
    li.onmousemove = () => { if (paletteSel !== i) { paletteSel = i; renderPalette(); } };
    li.onclick = () => runPalette(i);
    nodes.push(li);
  });
  list.replaceChildren(...nodes);
  list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function openPalette(): void {
  if (palette.open) { paletteInput.select(); return; }
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
  paletteInput.value = '';
  paletteSel = 0;
  send({ type: 'palette:toggle', open: true });
  palette.showModal();
  paletteInput.focus();
  renderPalette();
}

function runPalette(index: number): void {
  const it = paletteItems[index];
  if (!it) return;
  palette.close();
  const a = it.action;
  if (a.kind === 'command') send(a.command);
  else if (a.action === 'settings') openSettings();
  else if (a.action === 'vault') openVault();
  else if (a.action === 'modules') openModules();
  else if (a.action === 'bookmark') bookmarkCurrent();
  else if (a.action === 'bookmarks-manager') openBookmarkManager();
  else if (a.action === 'history') openHistory();
  else openWorkspaceDialog();
}

palette.addEventListener('close', () => {
  send({ type: 'palette:toggle', open: false });
});
paletteInput.addEventListener('input', () => {
  paletteSel = 0;
  send({ type: 'palette:query', text: paletteInput.value.slice(0, 500) }); // histórico vem no próximo estado
  renderPalette();
});
$('#palette-btn').onclick = openPalette;
paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = paletteItems.length;
    if (n) paletteSel = (paletteSel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    renderPalette();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runPalette(paletteSel);
  }
});

// ------------------------------------------------------------ diálogo de grupo

const groupDialog = $<HTMLDialogElement>('#group-dialog');
let editingGroup: GroupInfo | null = null;

$('#group-colors').replaceChildren(...GROUP_COLORS.map((c) => {
  const label = el('label', { className: 'swatch', title: c });
  label.style.background = c;
  label.appendChild(el('input', { type: 'radio', name: 'group-color', value: c }));
  return label;
}));

// O evento "editar grupo" pode chegar antes do estado que já tem o grupo novo:
// guarda o pedido e abre quando o grupo aparecer.
let pendingGroupEdit: string | null = null;

function openGroupDialog(groupId: string): void {
  const g = state?.groups.find((x) => x.id === groupId);
  if (!g) { pendingGroupEdit = groupId; return; }
  pendingGroupEdit = null;
  editingGroup = g;
  $<HTMLInputElement>('#group-name').value = g.name;
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="group-color"]')) r.checked = r.value === g.color;
  groupDialog.showModal();
  $('#group-name').focus();
}

$('#group-cancel').onclick = () => groupDialog.close();
$('#group-form').addEventListener('submit', () => {
  if (!editingGroup) return;
  const color = document.querySelector<HTMLInputElement>('input[name="group-color"]:checked')?.value ?? editingGroup.color;
  send({ type: 'group:update', groupId: editingGroup.id, name: $<HTMLInputElement>('#group-name').value.trim(), color });
});

// ------------------------------------------------------------ eventos

$('#add-workspace').onclick = () => openWorkspaceDialog();
$('#new-tab').onclick = () => send({ type: 'tab:new' });
$('#back').onclick = () => send({ type: 'tab:back' });
$('#forward').onclick = () => send({ type: 'tab:forward' });
$('#reload').onclick = () => send({ type: 'tab:reload' });

const menuAt = (sel: string) => {
  const r = $(sel).getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.bottom) };
};
$('#site-btn').onclick = () => send({ type: 'permission:menu', ...menuAt('#site-btn') });
$('#shield-btn').onclick = () => send({ type: 'privacy:menu', ...menuAt('#shield-btn') });
$('#key-btn').onclick = () => send({ type: 'vault:menu', ...menuAt('#key-btn') });

const answerPermission = (decision: PermissionDecision) => {
  const promptId = $('#permission-bar').dataset.promptId;
  if (!promptId) return;
  send({ type: 'permission:answer', promptId, decision, remember: $<HTMLInputElement>('#permission-remember').checked });
};
$('#permission-allow').onclick = () => answerPermission('allow');
$('#permission-deny').onclick = () => answerPermission('deny');

$('#update-primary').onclick = () => {
  $<HTMLButtonElement>('#update-primary').disabled = true;
  send({ type: $('#update-primary').dataset.action === 'install' ? 'update:install' : 'update:download' });
};
$('#update-later').onclick = () => { updateDismissed = true; $('#update-bar').hidden = true; };

$<HTMLInputElement>('#address').addEventListener('input', () => { addressEdited = true; });
$<HTMLInputElement>('#address').addEventListener('keydown', (e) => {
  const input = e.target as HTMLInputElement;
  if (e.key === 'Enter') {
    const url = normalizeUrl(input.value);
    if (!url) return;
    addressEdited = false;
    input.blur();
    send({ type: 'tab:navigate', url });
  } else if (e.key === 'Escape') {
    const tab = state?.tabs.find((t) => t.id === state?.activeTabId);
    input.value = isHomeUrl(tab?.url) ? '' : tab?.url ?? '';
    addressEdited = false;
    input.blur();
    send({ type: 'tab:focus' });
  }
});
$<HTMLInputElement>('#address').addEventListener('blur', () => render());

// ------------------------------------------------------------ diálogos × página nativa
// A página é desenhada pelo processo principal POR CIMA desta interface: enquanto houver
// QUALQUER diálogo aberto, ela fica escondida. Regra única (observa o atributo "open").
// Regressão: cada diálogo avisava sozinho; ao trocar de um diálogo para outro, o aviso
// "fechou" chegava depois do "abriu" e a página cobria o diálogo novo (tela escura).
let overlayShown = false;
// A página de configurações também cobre a área da página do site.
const syncOverlay = () => {
  const open = document.querySelector('dialog[open]') !== null || !$('#settings-page').hidden;
  if (open === overlayShown) return;
  overlayShown = open;
  send({ type: 'layout:overlay', open });
};
const dialogObserver = new MutationObserver(syncOverlay);
for (const d of document.querySelectorAll('dialog')) dialogObserver.observe(d, { attributes: true, attributeFilter: ['open'] });

window.apollo.onState((next) => {
  // Trocou de site: fecha o painel de permissões.
  state = next;
  render();
  if (pendingGroupEdit) openGroupDialog(pendingGroupEdit);
});

window.apollo.onEvent((event) => {
  if (event.type === 'open-palette') {
    openPalette();
  } else if (event.type === 'open-vault') {
    if (!vaultDialog.open) openVault();
  } else if (event.type === 'open-find') {
    openFind();
  } else if (event.type === 'edit-bookmark') {
    openBookmarkDialog(event.bookmarkId);
  } else if (event.type === 'new-bookmark-folder') {
    openNewFolderDialog(event.parentId);
  } else if (event.type === 'manage-bookmarks') {
    openBookmarkManager();
  } else if (event.type === 'open-history') {
    if (!historyDialog.open) openHistory();
  } else if (event.type === 'edit-group') {
    openGroupDialog(event.groupId);
  } else if (event.type === 'focus-address') {
    const input = $<HTMLInputElement>('#address');
    input.focus();
    input.select();
  }
});

sendBounds();
