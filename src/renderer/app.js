'use strict';

const DEFAULT_HOME = 'https://www.google.com';
const SEARCH_URL = 'https://www.google.com/search?q=';

const $ = (sel) => document.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);

/** @type {{activeWorkspaceId: string, workspaces: Array<any>}} */
let state;
const webviews = new Map(); // tabId -> <webview>

// ---------------------------------------------------------------- estado

function defaultState() {
  const make = (name, color, home) => {
    const tab = { id: uid(), url: home, title: name };
    return { id: uid(), name, color, home, tabs: [tab], activeTabId: tab.id };
  };
  const workspaces = [
    make('Pessoal', '#7c5cff', 'https://outlook.live.com/mail/'),
    make('Trabalho', '#0f9d58', 'https://outlook.office.com/mail/'),
    make('Faculdade', '#f4b400', 'https://outlook.office.com/mail/'),
  ];
  return { activeWorkspaceId: workspaces[0].id, workspaces };
}

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.apollo.saveState(state), 300);
}

// Cada workspace = uma partição persistente própria (cookies, storage, cache isolados).
const partitionOf = (ws) => `persist:ws-${ws.id}`;
const activeWs = () => state.workspaces.find((w) => w.id === state.activeWorkspaceId);
const findWs = (id) => state.workspaces.find((w) => w.id === id);
const activeTab = (ws = activeWs()) => ws?.tabs.find((t) => t.id === ws.activeTabId);

function normalizeUrl(input) {
  const text = input.trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text; // já tem esquema
  if (/^localhost(:\d+)?(\/|$)/.test(text)) return `http://${text}`;
  if (!/\s/.test(text) && /\.[a-z]{2,}(:\d+)?(\/|$)/i.test(text)) return `https://${text}`;
  return SEARCH_URL + encodeURIComponent(text);
}

// ---------------------------------------------------------------- webviews

function ensureWebview(ws, tab) {
  let wv = webviews.get(tab.id);
  if (wv) return wv;

  wv = document.createElement('webview');
  wv.dataset.tabId = tab.id;
  wv.dataset.wsId = ws.id;
  wv.setAttribute('partition', partitionOf(ws)); // precisa vir antes do src
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', tab.url || ws.home || DEFAULT_HOME);
  wv.classList.add('hidden');

  const update = (patch) => {
    Object.assign(tab, patch);
    persist();
    if (findWs(ws.id) && state.activeWorkspaceId === ws.id) render();
  };

  wv.addEventListener('dom-ready', () => { wv.ready = true; });
  wv.addEventListener('page-title-updated', (e) => update({ title: e.title }));
  wv.addEventListener('page-favicon-updated', (e) => update({ favicon: e.favicons[0] }));
  wv.addEventListener('did-navigate', (e) => update({ url: e.url }));
  wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) update({ url: e.url }); });

  $('#views').appendChild(wv);
  webviews.set(tab.id, wv);
  return wv;
}

function destroyWebview(tabId) {
  webviews.get(tabId)?.remove();
  webviews.delete(tabId);
}

function navigate(ws, tab, url) {
  tab.url = url;
  const wv = ensureWebview(ws, tab);
  if (wv.ready) wv.loadURL(url).catch(() => {});
  else wv.setAttribute('src', url);
  persist();
  render();
}

// ---------------------------------------------------------------- ações

function newTab(ws = activeWs(), url = null, { background = false } = {}) {
  const tab = { id: uid(), url: url || ws.home || DEFAULT_HOME, title: 'Nova aba' };
  const idx = ws.tabs.findIndex((t) => t.id === ws.activeTabId);
  ws.tabs.splice(idx + 1, 0, tab);
  if (!background) ws.activeTabId = tab.id;
  ensureWebview(ws, tab);
  persist();
  render();
  if (!background && !url) focusAddress();
  return tab;
}

function closeTab(ws, tabId) {
  const idx = ws.tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  ws.tabs.splice(idx, 1);
  destroyWebview(tabId);
  if (ws.tabs.length === 0) {
    const tab = { id: uid(), url: ws.home || DEFAULT_HOME, title: 'Nova aba' };
    ws.tabs.push(tab);
  }
  if (ws.activeTabId === tabId) ws.activeTabId = (ws.tabs[idx] || ws.tabs[idx - 1] || ws.tabs[0]).id;
  persist();
  render();
}

function switchWorkspace(id) {
  if (!findWs(id)) return;
  state.activeWorkspaceId = id;
  persist();
  render();
}

function cycleTab(delta) {
  const ws = activeWs();
  const idx = ws.tabs.findIndex((t) => t.id === ws.activeTabId);
  ws.activeTabId = ws.tabs[(idx + delta + ws.tabs.length) % ws.tabs.length].id;
  persist();
  render();
}

function focusAddress() {
  const input = $('#address');
  input.focus();
  input.select();
}

function withActiveWebview(fn) {
  const wv = webviews.get(activeWs()?.activeTabId);
  if (wv?.ready) fn(wv);
}

// ---------------------------------------------------------------- render

function render() {
  const ws = activeWs();
  const tab = activeTab(ws);

  document.documentElement.style.setProperty('--ws-color', ws.color);
  document.title = `${tab?.title || 'Apollo'} — ${ws.name}`;
  $('#ws-badge').textContent = ws.name;

  // sidebar
  const list = $('#workspace-list');
  list.replaceChildren(...state.workspaces.map((w, i) => {
    const b = document.createElement('button');
    b.className = 'ws-btn' + (w.id === ws.id ? ' active' : '');
    b.style.background = w.color;
    b.textContent = w.name.trim().charAt(0).toUpperCase() || '?';
    b.title = `${w.name}${i < 9 ? ` (Ctrl+${i + 1})` : ''}\nClique direito para editar`;
    b.onclick = () => switchWorkspace(w.id);
    b.oncontextmenu = (e) => { e.preventDefault(); openWorkspaceDialog(w); };
    return b;
  }));

  // abas
  $('#tabs').replaceChildren(...ws.tabs.map((t) => {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === ws.activeTabId ? ' active' : '');
    el.title = t.title || t.url;
    if (t.favicon) {
      const img = document.createElement('img');
      img.src = t.favicon;
      img.onerror = () => img.remove();
      el.appendChild(img);
    }
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title || t.url;
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '×';
    close.onclick = (e) => { e.stopPropagation(); closeTab(ws, t.id); };
    el.append(title, close);
    el.onclick = () => { ws.activeTabId = t.id; persist(); render(); };
    el.onauxclick = (e) => { if (e.button === 1) closeTab(ws, t.id); };
    return el;
  }));

  // webviews: cria a ativa sob demanda, mostra só ela
  if (tab) ensureWebview(ws, tab);
  for (const [id, wv] of webviews) wv.classList.toggle('hidden', id !== tab?.id);

  const address = $('#address');
  if (document.activeElement !== address) address.value = tab?.url || '';
}

// ---------------------------------------------------------------- diálogo de workspace

let editingWs = null;

function openWorkspaceDialog(ws = null) {
  editingWs = ws;
  $('#ws-dialog-title').textContent = ws ? 'Editar workspace' : 'Novo workspace';
  $('#ws-name').value = ws?.name || '';
  $('#ws-color').value = ws?.color || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  $('#ws-home').value = ws?.home || '';
  $('#ws-delete').hidden = !ws || state.workspaces.length <= 1;
  $('#ws-dialog').showModal();
  $('#ws-name').focus();
}

$('#ws-form').addEventListener('submit', () => {
  const name = $('#ws-name').value.trim();
  const color = $('#ws-color').value;
  const home = normalizeUrl($('#ws-home').value) || DEFAULT_HOME;
  if (!name) return;

  if (editingWs) {
    Object.assign(editingWs, { name, color, home });
  } else {
    const tab = { id: uid(), url: home, title: name };
    const ws = { id: uid(), name, color, home, tabs: [tab], activeTabId: tab.id };
    state.workspaces.push(ws);
    state.activeWorkspaceId = ws.id;
  }
  persist();
  render();
});

$('#ws-cancel').onclick = () => $('#ws-dialog').close();

$('#ws-delete').onclick = async () => {
  const ws = editingWs;
  if (!ws) return;
  // Confirmação inline (window.confirm não é confiável no Electron)
  const btn = $('#ws-delete');
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = 'Clique de novo para confirmar (apaga logins)';
    setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Excluir workspace'; }, 4000);
    return;
  }
  btn.dataset.armed = '';
  btn.textContent = 'Excluir workspace';
  $('#ws-dialog').close();

  ws.tabs.forEach((t) => destroyWebview(t.id));
  state.workspaces = state.workspaces.filter((w) => w.id !== ws.id);
  if (state.activeWorkspaceId === ws.id) state.activeWorkspaceId = state.workspaces[0].id;
  await window.apollo.clearWorkspaceData(partitionOf(ws));
  persist();
  render();
};

// ---------------------------------------------------------------- eventos de UI

$('#add-workspace').onclick = () => openWorkspaceDialog();
$('#new-tab').onclick = () => newTab();
$('#back').onclick = () => withActiveWebview((wv) => wv.canGoBack() && wv.goBack());
$('#forward').onclick = () => withActiveWebview((wv) => wv.canGoForward() && wv.goForward());
$('#reload').onclick = () => withActiveWebview((wv) => wv.reload());

$('#address').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const url = normalizeUrl(e.target.value);
    if (!url) return;
    const ws = activeWs();
    navigate(ws, activeTab(ws), url);
    e.target.blur();
    withActiveWebview((wv) => wv.focus());
  } else if (e.key === 'Escape') {
    e.target.value = activeTab()?.url || '';
    e.target.blur();
  }
});

window.apollo.onShortcut((action) => {
  const ws = activeWs();
  if (action === 'new-tab') newTab();
  else if (action === 'close-tab') closeTab(ws, ws.activeTabId);
  else if (action === 'focus-address') focusAddress();
  else if (action === 'reload') withActiveWebview((wv) => wv.reload());
  else if (action === 'back') withActiveWebview((wv) => wv.canGoBack() && wv.goBack());
  else if (action === 'forward') withActiveWebview((wv) => wv.canGoForward() && wv.goForward());
  else if (action === 'next-tab') cycleTab(1);
  else if (action === 'prev-tab') cycleTab(-1);
  else if (action.startsWith('workspace-')) {
    const w = state.workspaces[Number(action.split('-')[1]) - 1];
    if (w) switchWorkspace(w.id);
  }
});

// Link "abrir em nova aba" dentro de uma página: abre no MESMO workspace da página de origem.
window.apollo.onOpenTab(({ fromWebContentsId, url, background }) => {
  let ws = activeWs();
  for (const wv of webviews.values()) {
    try {
      if (wv.ready && wv.getWebContentsId() === fromWebContentsId) { ws = findWs(wv.dataset.wsId) || ws; break; }
    } catch { /* webview ainda não pronta */ }
  }
  newTab(ws, url, { background });
});

// ---------------------------------------------------------------- atualizações

(() => {
  const bar = $('#update-bar');
  const text = $('#update-text');
  const primary = $('#update-primary');
  let stage = null;

  const show = (msg, button) => {
    text.textContent = msg;
    primary.hidden = !button;
    primary.disabled = false;
    if (button) primary.textContent = button;
    bar.hidden = false;
  };

  window.apollo.updates.onEvent(({ event, version, percent }) => {
    if (event === 'available') {
      stage = 'available';
      show(`Apollo ${version} disponível.`, 'Baixar e reiniciar');
    } else if (event === 'progress') {
      show(`Baixando atualização… ${percent}%`, null);
    } else if (event === 'downloaded') {
      stage = 'downloaded';
      show(`Apollo ${version} pronto. Suas abas serão restauradas.`, 'Reiniciar agora');
    } else if (event === 'error' && stage) {
      stage = null;
      show('Não foi possível atualizar agora. Tentaremos de novo mais tarde.', null);
    }
  });

  primary.onclick = async () => {
    primary.disabled = true;
    if (stage === 'available') {
      await window.apollo.updates.download();
    } else if (stage === 'downloaded') {
      await window.apollo.saveState(state); // garante a sessão salva antes de fechar
      window.apollo.updates.install();
    }
  };
  $('#update-later').onclick = () => { bar.hidden = true; };
})();

// ---------------------------------------------------------------- boot

(async () => {
  state = (await window.apollo.loadState()) || defaultState();
  if (!findWs(state.activeWorkspaceId)) state.activeWorkspaceId = state.workspaces[0].id;
  render();
  persist();
})();
