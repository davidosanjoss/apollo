// UI do navegador: sem privilégios. Desenha o estado que o processo principal
// envia e devolve comandos. Toda decisão (abas, sessões, permissões) é do main.
import type { ApolloApi } from '../preload/ui';
import type { GroupInfo, PermissionDecision, UiCommand, UiState, WorkspaceInfo } from '../shared/types';
import { GROUP_COLORS, HIBERNATE_OPTIONS_MIN, PERMISSION_LABELS, isHomeUrl } from '../shared/types';
import { normalizeUrl } from '../shared/url';
import { reconcile } from './reconcile';
import { buildStrip, computeDrop, type DropTarget, type StripItem } from './tab-strip';

declare global {
  interface Window { apollo: ApolloApi }
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const send = (cmd: UiCommand) => window.apollo.send(cmd);

let state: UiState | null = null;
let siteBarOpen = false;
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
    b.className = 'ws-btn' + (w.id === ws.id ? ' active' : '');
    b.textContent = w.name.trim().charAt(0).toUpperCase() || '?';
    b.title = `${w.name}${i < 9 ? ` (Ctrl+${i + 1})` : ''}\nClique direito para editar`;
    b.style.background = w.color;
  });

  // abas (com chips de grupo)
  reconcile($('#tabs'), stripEls, buildStrip(s.tabs, s.groups, s.activeTabId), (i) => i.key,
    (i) => (i.kind === 'group' ? createGroupChip(i.group.id) : createTabEl(i.tab.id)),
    (node, i) => (i.kind === 'group' ? updateGroupChip(node, i) : updateTabEl(node, i, s.activeTabId)));

  ($('#back') as HTMLButtonElement).disabled = !tab?.canGoBack;
  ($('#forward') as HTMLButtonElement).disabled = !tab?.canGoForward;

  const address = $<HTMLInputElement>('#address');
  if (document.activeElement !== address) address.value = isHomeUrl(tab?.url) ? '' : tab?.url ?? '';

  renderPermissionPrompt(s);
  renderSiteBar(s);
  renderUpdate(s);
}

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
  chip.textContent = g.collapsed ? `${g.name || ''} ${i.count}`.trim() : g.name;
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

function renderPermissionPrompt(s: UiState): void {
  const bar = $('#permission-bar');
  const p = s.permissionPrompt;
  bar.hidden = !p;
  if (!p) return;
  bar.dataset.promptId = p.id;
  const host = new URL(p.origin).host;
  $('#permission-text').textContent = `${host} quer usar: ${p.kinds.map((k) => PERMISSION_LABELS[k]).join(', ')}`;
}

function renderSiteBar(s: UiState): void {
  const info = s.sitePermissions;
  $('#site-btn').hidden = !info;
  const bar = $('#site-bar');
  bar.hidden = !(siteBarOpen && info);
  if (!info || bar.hidden) return;

  $('#site-origin').textContent = new URL(info.origin).host;
  $('#site-entries').replaceChildren(...info.entries.map(({ kind, decision }) => {
    const select = el('select');
    for (const [value, label] of [['', 'Padrão'], ['allow', 'Permitir'], ['deny', 'Bloquear']]) {
      select.appendChild(el('option', { value, textContent: label, selected: (decision ?? '') === value }));
    }
    select.onchange = () => send({
      type: 'permission:set', origin: info.origin, kind,
      decision: (select.value || null) as PermissionDecision | null,
    });
    const label = el('label', { textContent: PERMISSION_LABELS[kind] });
    label.appendChild(select);
    return label;
  }));
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

const hibernateLabel = (m: number) => (m === 0 ? 'Nunca' : m < 60 ? `${m} minutos` : m === 60 ? '1 hora' : `${m / 60} horas`);
$('#ws-hibernate').replaceChildren(...HIBERNATE_OPTIONS_MIN.map((m) => el('option', { value: String(m), textContent: hibernateLabel(m) })));

function openWorkspaceDialog(ws: WorkspaceInfo | null = null): void {
  editing = ws;
  $('#ws-dialog-title').textContent = ws ? 'Editar workspace' : 'Novo workspace';
  $<HTMLInputElement>('#ws-name').value = ws?.name ?? '';
  $<HTMLInputElement>('#ws-color').value = ws?.color ?? '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  $<HTMLInputElement>('#ws-home').value = ws && !isHomeUrl(ws.home) ? ws.home : '';
  $<HTMLSelectElement>('#ws-hibernate').value = String(ws?.hibernateAfterMin ?? 30);
  $('#ws-delete').hidden = !ws || (state?.workspaces.length ?? 0) <= 1;
  send({ type: 'layout:overlay', open: true }); // a página nativa cobriria o diálogo
  dialog.showModal();
  $('#ws-name').focus();
}

dialog.addEventListener('close', () => send({ type: 'layout:overlay', open: false }));

$('#ws-form').addEventListener('submit', () => {
  const name = $<HTMLInputElement>('#ws-name').value.trim();
  const color = $<HTMLInputElement>('#ws-color').value;
  const home = normalizeUrl($<HTMLInputElement>('#ws-home').value) ?? '';
  const hibernateAfterMin = Number($<HTMLSelectElement>('#ws-hibernate').value);
  if (!name) return;
  if (editing) send({ type: 'workspace:update', workspaceId: editing.id, name, color, home, hibernateAfterMin });
  else send({ type: 'workspace:create', name, color, home, hibernateAfterMin });
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
  send({ type: 'layout:overlay', open: true });
  groupDialog.showModal();
  $('#group-name').focus();
}

groupDialog.addEventListener('close', () => send({ type: 'layout:overlay', open: false }));
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

$('#site-btn').onclick = () => { siteBarOpen = !siteBarOpen; render(); };
$('#site-close').onclick = () => { siteBarOpen = false; render(); };

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

$<HTMLInputElement>('#address').addEventListener('keydown', (e) => {
  const input = e.target as HTMLInputElement;
  if (e.key === 'Enter') {
    const url = normalizeUrl(input.value);
    if (!url) return;
    input.blur();
    send({ type: 'tab:navigate', url });
  } else if (e.key === 'Escape') {
    const tab = state?.tabs.find((t) => t.id === state?.activeTabId);
    input.value = isHomeUrl(tab?.url) ? '' : tab?.url ?? '';
    input.blur();
    send({ type: 'tab:focus' });
  }
});
$<HTMLInputElement>('#address').addEventListener('blur', () => render());

window.apollo.onState((next) => {
  // Trocou de site: fecha o painel de permissões.
  if (state && next.sitePermissions?.origin !== state.sitePermissions?.origin) siteBarOpen = false;
  state = next;
  render();
  if (pendingGroupEdit) openGroupDialog(pendingGroupEdit);
});

window.apollo.onEvent((event) => {
  if (event.type === 'edit-group') {
    openGroupDialog(event.groupId);
  } else if (event.type === 'focus-address') {
    const input = $<HTMLInputElement>('#address');
    input.focus();
    input.select();
  }
});

sendBounds();
