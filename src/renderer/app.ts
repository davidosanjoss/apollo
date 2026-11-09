// UI do navegador: sem privilégios. Desenha o estado que o processo principal
// envia e devolve comandos. Toda decisão (abas, sessões, permissões) é do main.
import type { ApolloApi } from '../preload/ui';
import type { DnsMode, GroupInfo, PermissionDecision, PrivacyFeature, UiCommand, UiState, WorkspaceInfo } from '../shared/types';
import { GROUP_COLORS, HIBERNATE_OPTIONS_MIN, MEMORY_LIMIT_OPTIONS_MB, PERMISSION_LABELS, PRIVACY_LABELS, isHomeUrl } from '../shared/types';
import { normalizeUrl } from '../shared/url';
import { hasCustomPermissions, shieldState } from '../shared/shield';
import { reconcile } from './reconcile';
import { buildStrip, computeDrop, type DropTarget, type StripItem } from './tab-strip';

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

  renderPermissionPrompt(s);
  renderSiteBar(s);
  renderUpdate(s);
  renderMemory(s);
  renderSettings(s);
  renderVault(s);
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
    li.querySelector('.mb')!.textContent = t.mb === null ? 'hibernada' : fmtMb(t.mb);
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
  else send({ type: 'workspace:create', name, color, home, hibernateAfterMin, temporary: $<HTMLInputElement>('#ws-temporary').checked });
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
  send({ type: 'layout:overlay', open: true });
  settingsDialog.showModal();
  renderSettings(state);
}

$('#settings-btn').onclick = openSettings;
settingsDialog.addEventListener('close', () => send({ type: 'layout:overlay', open: false }));
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
  send({ type: 'layout:overlay', open: true });
  vaultDialog.showModal();
  renderVault(state);
  const focus = state.vault.status === 'locked' ? '#vault-password' : state.vault.status === 'disconnected' ? '#vault-client-id' : null;
  if (focus) $(focus).focus();
}

$('#vault-btn').onclick = openVault;
vaultDialog.addEventListener('close', () => {
  send({ type: 'layout:overlay', open: false });
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

const menuAt = (sel: string) => {
  const r = $(sel).getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.bottom) };
};
$('#site-btn').onclick = () => send({ type: 'permission:menu', ...menuAt('#site-btn') });
$('#shield-btn').onclick = () => send({ type: 'privacy:menu', ...menuAt('#shield-btn') });

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

window.apollo.onState((next) => {
  // Trocou de site: fecha o painel de permissões.
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
