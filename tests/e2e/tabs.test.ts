// Fase 2b: ordem, fixadas, grupos, duplicar, fechar outras.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UiState } from '../../src/shared/types';
import { Apollo, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const titles = (s: UiState) => s.tabs.map((t) => t.title);
const byTitle = (s: UiState, title: string) => s.tabs.find((t) => t.title === title)!;

async function openTabs(...names: string[]) {
  for (const [i, n] of names.entries()) {
    if (i > 0 || (await app.state()).tabs.some((t) => !t.url.startsWith('apollo://home'))) await app.send({ type: 'tab:new' });
    await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=${n}` });
    await app.until((s) => app.activeTab(s).title === n, `aba ${n}`);
  }
  return app.state();
}

async function closeAllBut(keep: string) {
  const s = await app.state();
  await app.send({ type: 'tab:close-others', tabId: byTitle(s, keep).id });
  await app.until((x) => x.tabs.length === x.tabs.filter((t) => t.pinned).length + 1, 'outras fechadas');
}

describe('organização das abas', () => {
  it('fixar leva a aba para o começo; desafixar devolve', async () => {
    let s = await openTabs('A', 'B', 'C');
    expect(titles(s)).toEqual(['A', 'B', 'C']);
    await app.send({ type: 'tab:pin', tabId: byTitle(s, 'C').id, pinned: true });
    s = await app.until((x) => x.tabs[0].title === 'C', 'C fixada no começo');
    expect(s.tabs[0].pinned).toBe(true);
    expect(await app.ui.eval(`document.querySelector('#tabs .tab').classList.contains('pinned')`)).toBe(true);
    await app.send({ type: 'tab:pin', tabId: byTitle(s, 'C').id, pinned: false });
    await app.until((x) => !x.tabs[0].pinned, 'desafixada');
  });

  it('criar grupo abre o diálogo; nome e cor aparecem no chip', async () => {
    let s = await app.state();
    await app.send({ type: 'group:create', tabId: byTitle(s, 'A').id });
    s = await app.until((x) => x.groups.length === 1, 'grupo criado');
    const g = s.groups[0];
    expect(byTitle(s, 'A').groupId).toBe(g.id);
    // Regressão: o evento chegava antes do estado com o grupo novo e o diálogo não abria.
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('group-dialog').open`), 'diálogo do grupo aberto');

    await app.ui.eval(`document.getElementById('group-name').value = 'Faculdade';
      document.querySelector('input[name="group-color"][value="#3fb950"]').checked = true;
      document.getElementById('group-form').requestSubmit(); true`);
    s = await app.until((x) => x.groups[0]?.name === 'Faculdade', 'grupo renomeado');
    expect(s.groups[0].color).toBe('#3fb950');
    expect(await app.ui.eval(`document.querySelector('.group-chip').textContent`)).toBe('Faculdade');
  });

  it('arrastar (pela UI) uma aba sobre o chip coloca no grupo', async () => {
    const s0 = await app.state();
    const c = byTitle(s0, 'C').id;
    await app.ui.eval(`(() => {
      const dt = new DataTransfer();
      const tab = document.querySelector('.tab[data-tab-id="${c}"]');
      const chip = document.querySelector('.group-chip');
      tab.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      chip.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      chip.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      tab.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return true;
    })()`);
    const s = await app.until((x) => byTitle(x, 'C').groupId === x.groups[0].id, 'C no grupo');
    expect(titles(s)).toEqual(['C', 'A', 'B']);
  });

  it('recolher esconde as abas do grupo (menos a ativa); ativar uma delas expande', async () => {
    let s = await app.state();
    await app.send({ type: 'tab:activate', tabId: byTitle(s, 'B').id });
    await app.send({ type: 'group:collapse', groupId: s.groups[0].id, collapsed: true });
    s = await app.until((x) => x.groups[0].collapsed, 'recolhido');
    const hidden = await app.ui.eval<number>(`document.querySelectorAll('#tabs .tab[hidden]').length`);
    expect(hidden).toBe(2);
    expect(await app.ui.eval(`document.querySelector('.group-chip').textContent`)).toBe('Faculdade 2');

    await app.send({ type: 'tab:activate', tabId: byTitle(s, 'A').id });
    await app.until((x) => !x.groups[0].collapsed, 'expandido ao ativar');
  });

  it('recolher o grupo da aba ativa ativa uma aba fora dele', async () => {
    let s = await app.state();
    await app.send({ type: 'tab:activate', tabId: byTitle(s, 'A').id });
    await app.send({ type: 'group:collapse', groupId: s.groups[0].id, collapsed: true });
    s = await app.until((x) => x.groups[0].collapsed && app.activeTab(x).title === 'B', 'B ativa');
    await app.send({ type: 'group:collapse', groupId: s.groups[0].id, collapsed: false });
  });

  it('nova aba aberta de uma aba do grupo entra no grupo', async () => {
    let s = await app.state();
    await app.send({ type: 'tab:activate', tabId: byTitle(s, 'C').id });
    await app.send({ type: 'tab:new' });
    s = await app.until((x) => x.tabs.length === 4, 'nova aba');
    expect(app.activeTab(s).groupId).toBe(s.groups[0].id);
    expect(s.tabs.findIndex((t) => t.id === s.activeTabId)).toBe(1); // logo depois de C
    await app.send({ type: 'tab:close', tabId: s.activeTabId! });
    await app.until((x) => x.tabs.length === 3, 'fechada');
  });

  it('fechar a aba e reabrir: volta para o grupo', async () => {
    let s = await app.state();
    await app.send({ type: 'tab:close', tabId: byTitle(s, 'A').id });
    await app.until((x) => x.tabs.length === 2, 'A fechada');
    await app.send({ type: 'tab:reopen' });
    s = await app.until((x) => x.tabs.length === 3, 'A reaberta');
    expect(titles(s)).toEqual(['C', 'A', 'B']);
    expect(byTitle(s, 'A').groupId).toBe(s.groups[0].id);
  });

  it('desagrupar mantém as abas; o grupo some', async () => {
    let s = await app.state();
    await app.send({ type: 'group:ungroup', groupId: s.groups[0].id });
    s = await app.until((x) => x.groups.length === 0, 'grupo removido');
    expect(s.tabs.every((t) => t.groupId === null)).toBe(true);
    expect(titles(s)).toEqual(['C', 'A', 'B']);
  });

  it('duplicar copia a aba ao lado, com o histórico', async () => {
    let s = await app.state();
    const b = byTitle(s, 'B');
    await app.send({ type: 'tab:activate', tabId: b.id });
    await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=B2` });
    await app.until((x) => app.activeTab(x).title === 'B2' && app.activeTab(x).canGoBack, 'B2');
    await app.send({ type: 'tab:duplicate', tabId: b.id });
    s = await app.until((x) => x.tabs.length === 4 && x.activeTabId !== b.id && app.activeTab(x).canGoBack, 'cópia com histórico');
    expect(titles(s)).toEqual(['C', 'A', 'B2', 'B2']);
  });

  it('fechar outras abas mantém as fixadas', async () => {
    let s = await app.state();
    await app.send({ type: 'tab:pin', tabId: byTitle(s, 'C').id, pinned: true });
    await app.until((x) => x.tabs[0].pinned, 'C fixada');
    await closeAllBut('A');
    s = await app.state();
    expect(titles(s)).toEqual(['C', 'A']);
  });

  it('fixadas e grupos sobrevivem ao reinício', async () => {
    let s = await app.state();
    await app.send({ type: 'group:create', tabId: byTitle(s, 'A').id });
    await app.until((x) => x.groups.length === 1, 'grupo');
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('group-dialog').open`), 'diálogo');
    await app.ui.eval(`document.getElementById('group-dialog').close(); true`);
    await app.quit();

    app = await Apollo.launch(profile.dir);
    s = await app.state();
    expect(titles(s)).toEqual(['C', 'A']);
    expect(s.tabs[0].pinned).toBe(true);
    expect(s.groups).toHaveLength(1);
    expect(byTitle(s, 'A').groupId).toBe(s.groups[0].id);
  });
});

describe('aparência', () => {
  // Regressão: fixada sem ícone (favicon inexistente/404) aparecia como um espaço vazio.
  it('aba fixada sem ícone mostra a inicial do título', async () => {
    const s = await app.state();
    const pinned = s.tabs.find((t) => t.pinned)!;
    const letter = await app.ui.eval<string | null>(`(() => {
      const l = document.querySelector('.tab[data-tab-id="${pinned.id}"] .letter');
      return l && !l.hidden ? l.textContent : null;
    })()`);
    expect(letter).toBe(pinned.title.charAt(0).toUpperCase());
  });
});
