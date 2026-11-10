// UI do navegador: sem privilégios. Desenha o estado que o processo principal
// envia e devolve comandos. Toda decisão (abas, sessões, permissões) é do main.
import type { ApolloApi } from '../preload/ui';
import type { DnsMode, ScreenSource, SpellcheckMode, GroupInfo, PermissionDecision, PrivacyFeature, UiCommand, UiState, WorkspaceInfo } from '../shared/types';
import { GENERATOR_LENGTHS, GROUP_COLORS, HIDDEN_HIBERNATE_OPTIONS_MIN, PANEL_DEFAULT_WIDTH, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, PANEL_SUGGESTIONS, HIBERNATE_OPTIONS_MIN, MEMORY_LIMIT_OPTIONS_MB, PERMISSION_LABELS, PRIVACY_LABELS, isHomeUrl } from '../shared/types';
import { normalizeUrl, SEARCH_URL } from '../shared/url';
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
    b.textContent = w.name.trim().charAt(0).toUpperCase() || '?';
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
  renderFind(s);
  renderBookmarks(s);
  renderPermissionPrompt(s);
  renderSavePrompt(s);
  renderSiteBar(s);
  renderUpdate(s);
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

// ------------------------------------------------------------ favoritos

const bookmarkDialog = $<HTMLDialogElement>('#bookmark-dialog');
let editingBookmark: string | null = null;
/** Esperando o favorito recém-criado aparecer no estado para abrir o diálogo. */
let bookmarkPending = false;

function openBookmarkDialog(id: string): void {
  const b = state?.bookmarks.find((x) => x.id === id);
  if (!b) return;
  editingBookmark = id;
  $<HTMLInputElement>('#bookmark-title').value = b.title;
  $<HTMLInputElement>('#bookmark-url').value = b.url;
  if (!bookmarkDialog.open) bookmarkDialog.showModal();
  $<HTMLInputElement>('#bookmark-title').select();
}

/** Estrela / Ctrl+K: marca a página (se ainda não for) e abre o diálogo para editar. */
function bookmarkCurrent(): void {
  if (state?.activeBookmarkId) { openBookmarkDialog(state.activeBookmarkId); return; }
  bookmarkPending = true;
  send({ type: 'bookmark:add' });
}

$('#bookmark-btn').onclick = bookmarkCurrent;
$('#bookmark-cancel').onclick = () => bookmarkDialog.close();
$('#bookmark-remove').onclick = () => {
  if (editingBookmark) send({ type: 'bookmark:remove', bookmarkId: editingBookmark });
  bookmarkDialog.close();
};
$('#bookmark-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = normalizeUrl($<HTMLInputElement>('#bookmark-url').value);
  if (!editingBookmark || !url) return;
  send({ type: 'bookmark:update', bookmarkId: editingBookmark, title: $<HTMLInputElement>('#bookmark-title').value, url });
  bookmarkDialog.close();
});
bookmarkDialog.addEventListener('close', () => { editingBookmark = null; });

let homeBookmarksKey = '';
let draggingBookmark: string | null = null;

function renderBookmarks(s: UiState): void {
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  const btn = $<HTMLButtonElement>('#bookmark-btn');
  btn.hidden = !tab || isHomeUrl(tab.url) || !/^(https?|file):/i.test(tab.url);
  btn.textContent = s.activeBookmarkId ? '★' : '☆';
  btn.classList.toggle('on', Boolean(s.activeBookmarkId));
  btn.title = s.activeBookmarkId ? 'Editar o favorito (Ctrl+D)' : 'Adicionar aos favoritos (Ctrl+D)';
  if (bookmarkPending && s.activeBookmarkId) { bookmarkPending = false; openBookmarkDialog(s.activeBookmarkId); }

  // Blocos da página inicial: só redesenha quando os favoritos mudam.
  const key = JSON.stringify(s.bookmarks);
  if (key === homeBookmarksKey) return;
  homeBookmarksKey = key;
  $('#home-bookmarks').replaceChildren(...s.bookmarks.map((b, i) => {
    const li = el('li');
    li.dataset.bookmarkId = b.id;
    li.draggable = true;
    const a = el('a', { href: b.url, title: `${b.title}\n${b.url}` });
    a.draggable = false;
    const icon = el('span', { className: 'icon' });
    if (b.favicon) {
      const img = el('img', { src: b.favicon, alt: '' });
      img.onerror = () => { img.remove(); icon.textContent = initial(b); };
      icon.append(img);
    } else {
      icon.textContent = initial(b);
    }
    a.append(icon, el('span', { className: 'name', textContent: b.title }));
    a.onclick = (e) => { e.preventDefault(); send({ type: 'bookmark:open', bookmarkId: b.id, newTab: e.ctrlKey || e.metaKey }); };
    a.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); send({ type: 'bookmark:open', bookmarkId: b.id, newTab: true }); } };
    a.oncontextmenu = (e) => { e.preventDefault(); openBookmarkDialog(b.id); };
    // Arrastar para reordenar.
    li.ondragstart = (e) => { draggingBookmark = b.id; li.classList.add('dragging'); e.dataTransfer?.setData('text/plain', b.id); };
    li.ondragend = () => { draggingBookmark = null; li.classList.remove('dragging'); clearDrop(); };
    const after = (e: DragEvent) => { const r = li.getBoundingClientRect(); return e.clientX > r.left + r.width / 2; };
    li.ondragover = (e) => {
      if (!draggingBookmark) return;
      e.preventDefault();
      clearDrop();
      li.classList.add(after(e) ? 'drop-after' : 'drop-before');
    };
    li.ondrop = (e) => {
      e.preventDefault();
      const from = s.bookmarks.findIndex((x) => x.id === draggingBookmark);
      const target = after(e) ? i + 1 : i; // posição na lista atual
      if (draggingBookmark && from >= 0) {
        const index = from < target ? target - 1 : target; // posição final, sem o arrastado
        if (index !== from) send({ type: 'bookmark:move', bookmarkId: draggingBookmark, index });
      }
      clearDrop();
    };
    li.append(a);
    return li;
  }));
}

const initial = (b: { title: string; url: string }) => (b.title.trim()[0] ?? readableUrl(b.url)[0] ?? '?').toUpperCase();
const clearDrop = () => { for (const n of document.querySelectorAll('.drop-before, .drop-after')) n.classList.remove('drop-before', 'drop-after'); };

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

function renderUpdate(s: UiState): void {
  const bar = $('#update-bar');
  const u = s.update;
  const primary = $<HTMLButtonElement>('#update-primary');
  if (!u || (updateDismissed && u.stage === 'available')) { bar.hidden = true; return; }
  bar.hidden = false;
  primary.hidden = u.stage === 'downloading' || u.stage === 'error';
  primary.disabled = false;
  if (u.stage === 'available') {
    $('#update-text').textContent = `Apollo ${u.version} disponível.`;
    primary.textContent = 'Baixar e reiniciar';
    primary.dataset.action = 'download';
  } else if (u.stage === 'downloading') {
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

function openWorkspaceDialog(ws: WorkspaceInfo | null = null): void {
  editing = ws;
  $('#ws-dialog-title').textContent = ws ? 'Editar workspace' : 'Novo workspace';
  $<HTMLInputElement>('#ws-name').value = ws?.name ?? '';
  $<HTMLInputElement>('#ws-color').value = ws?.color ?? '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  $<HTMLInputElement>('#ws-home').value = ws && !isHomeUrl(ws.home) ? ws.home : '';
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
  if (!name) return;
  if (editing) send({ type: 'workspace:update', workspaceId: editing.id, name, color, home, hibernateAfterMin, hiddenHibernateMin });
  else send({ type: 'workspace:create', name, color, home, hibernateAfterMin, hiddenHibernateMin, temporary: $<HTMLInputElement>('#ws-temporary').checked });
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

const settingsDialog = $<HTMLDialogElement>('#settings-dialog');

function renderSettings(s: UiState): void {
  if (!settingsDialog.open) return;
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

function openSettings(): void {
  if (!state) return;
  $<HTMLSelectElement>('#dns-mode').value = state.settings.dns.mode;
  $<HTMLInputElement>('#dns-url').value = state.settings.dns.dohUrl ?? '';
  settingsDialog.showModal();
  renderSettings(state);
}

$('#settings-btn').onclick = openSettings;
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

const modulesDialog = $<HTMLDialogElement>('#modules-dialog');
let editingCustom: string | null = null; // id em edição (null = nova)

function renderModules(s: UiState): void {
  if (!modulesDialog.open) return;
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
  if (!state) return;
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) if (d !== modulesDialog) d.close();
  showModulesView(false);
  if (!modulesDialog.open) modulesDialog.showModal();
  renderModules(state);
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

$('#open-modules').onclick = openModules;
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
  else openWorkspaceDialog();
}

palette.addEventListener('close', () => {
  send({ type: 'palette:toggle', open: false });
});
paletteInput.addEventListener('input', () => { paletteSel = 0; renderPalette(); });
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
const syncOverlay = () => {
  const open = document.querySelector('dialog[open]') !== null;
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
  } else if (event.type === 'edit-group') {
    openGroupDialog(event.groupId);
  } else if (event.type === 'focus-address') {
    const input = $<HTMLInputElement>('#address');
    input.focus();
    input.select();
  }
});

sendBounds();
