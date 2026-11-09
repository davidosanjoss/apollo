// UI do navegador: sem privilégios. Desenha o estado que o processo principal
// envia e devolve comandos. Toda decisão (abas, sessões, permissões) é do main.
import type { ApolloApi } from '../preload/ui';
import type { PermissionDecision, UiCommand, UiState, WorkspaceInfo } from '../shared/types';
import { PERMISSION_LABELS, isHomeUrl } from '../shared/types';
import { normalizeUrl } from '../shared/url';
import { reconcile } from './reconcile';

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

const tabEls = new Map<string, HTMLElement>();
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

  // abas
  reconcile($('#tabs'), tabEls, s.tabs, (t) => t.id, (t) => {
    const item = el('div');
    const img = el('img', { alt: '' });
    img.onerror = () => { img.hidden = true; };
    const close = el('button', { className: 'close', textContent: '×', title: 'Fechar (Ctrl+W)' });
    close.onclick = (e) => { e.stopPropagation(); send({ type: 'tab:close', tabId: t.id }); };
    item.append(img, el('span', { className: 'title' }), close);
    item.onclick = () => send({ type: 'tab:activate', tabId: t.id });
    item.onauxclick = (e) => { if (e.button === 1) send({ type: 'tab:close', tabId: t.id }); };
    return item;
  }, (item, t) => {
    item.className = ['tab', t.id === s.activeTabId && 'active', t.dormant && 'dormant', t.loading && 'loading'].filter(Boolean).join(' ');
    item.title = t.title || t.url;
    const img = item.querySelector('img')!;
    if (t.favicon) {
      if (img.getAttribute('src') !== t.favicon) { img.hidden = false; img.src = t.favicon; }
    } else {
      img.hidden = true;
      img.removeAttribute('src');
    }
    item.querySelector('.title')!.textContent = t.title || t.url;
  });

  ($('#back') as HTMLButtonElement).disabled = !tab?.canGoBack;
  ($('#forward') as HTMLButtonElement).disabled = !tab?.canGoForward;

  const address = $<HTMLInputElement>('#address');
  if (document.activeElement !== address) address.value = isHomeUrl(tab?.url) ? '' : tab?.url ?? '';

  renderPermissionPrompt(s);
  renderSiteBar(s);
  renderUpdate(s);
}

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

function openWorkspaceDialog(ws: WorkspaceInfo | null = null): void {
  editing = ws;
  $('#ws-dialog-title').textContent = ws ? 'Editar workspace' : 'Novo workspace';
  $<HTMLInputElement>('#ws-name').value = ws?.name ?? '';
  $<HTMLInputElement>('#ws-color').value = ws?.color ?? '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  $<HTMLInputElement>('#ws-home').value = ws && !isHomeUrl(ws.home) ? ws.home : '';
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
  if (!name) return;
  if (editing) send({ type: 'workspace:update', workspaceId: editing.id, name, color, home });
  else send({ type: 'workspace:create', name, color, home });
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
});

window.apollo.onEvent((event) => {
  if (event.type === 'focus-address') {
    const input = $<HTMLInputElement>('#address');
    input.focus();
    input.select();
  }
});

sendBounds();
