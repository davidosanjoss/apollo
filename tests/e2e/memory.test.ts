// Fase 2d: monitor de memória.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, sleep, startSite, tempProfile, waitFor, type TestSite } from './harness';

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

async function open(path: string, title: string, newTab = true) {
  if (newTab) await app.send({ type: 'tab:new' });
  await app.send({ type: 'tab:navigate', url: `${site.url}${path}` });
  return app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, `abrir ${title}`);
}

describe('monitor de memória', () => {
  it('fechado: nada é medido', async () => {
    await open('/page?title=Um', 'Um', false);
    await open('/page?title=Dois', 'Dois');
    expect((await app.state()).memory).toBeNull();
  });

  it('abrir mostra o total e cada aba; a página encolhe para dar lugar ao painel', async () => {
    const page = await app.page(`${site.url}/page?title=Dois`);
    const before = await page.eval<number>('innerWidth');

    await app.send({ type: 'memory:toggle', open: true });
    const s = await app.until((x) => x.memory !== null && x.memory.tabs.length === 2, 'relatório');
    const m = s.memory!;
    expect(m.totalMb).toBeGreaterThan(50);
    expect(m.otherMb).toBeGreaterThan(0);
    expect(m.tabs.every((t) => t.mb !== null && t.mb > 0)).toBe(true);
    expect(m.tabs.find((t) => t.visible)!.title).toBe('Dois');
    expect(await app.ui.eval('!document.getElementById("memory-panel").hidden')).toBe(true);
    expect(await app.ui.eval('document.querySelectorAll("#memory-tabs li").length')).toBe(2);

    await waitFor(async () => (await page.eval<number>('innerWidth')) < before - 200, 'página mais estreita');
    page.close();
  });

  it('botão "Hibernar" no painel libera a aba (clique real)', async () => {
    let s = await app.state();
    const um = s.memory!.tabs.find((t) => t.title === 'Um')!;
    await app.ui.mouseClick(`#memory-tabs li[data-tab-id="${um.id}"] button`);
    s = await app.until((x) => x.memory!.tabs.find((t) => t.id === um.id)!.mb === null, 'Um hibernada no relatório');
    expect(s.tabs.find((t) => t.id === um.id)!.dormant).toBe(true);
    expect(await app.ui.eval(`document.querySelector('#memory-tabs li[data-tab-id="${um.id}"] .mb').textContent`)).toBe('hibernada');
  });

  it('lista abas de todos os workspaces; clicar leva até a aba', async () => {
    await app.send({ type: 'workspace:create', name: 'Trabalho', color: '#123456', home: '' });
    let s = await app.until((x) => x.workspaces.length === 2, 'workspace');
    await open('/page?title=Relatorio', 'Relatorio', false);
    s = await app.until((x) => x.memory!.tabs.some((t) => t.title === 'Relatorio'), 'aba do Trabalho no relatório');
    const principal = s.workspaces.find((w) => w.name === 'Principal')!.id;
    const dois = s.memory!.tabs.find((t) => t.title === 'Dois')!;
    expect(dois.workspaceId).toBe(principal);

    await app.ui.mouseClick(`#memory-tabs li[data-tab-id="${dois.id}"] .name`);
    s = await app.until((x) => x.activeWorkspaceId === principal && x.activeTabId === dois.id, 'foi para a aba');
  });

  it('limite de memória é salvo', async () => {
    await app.ui.eval(`(() => { const s = document.getElementById('memory-limit'); s.value = '4096'; s.dispatchEvent(new Event('change')); return true; })()`);
    await app.until((x) => x.memory!.limitMb === 4096, 'limite salvo');
  });

  it('fechar para de medir e devolve a largura à página', async () => {
    await app.send({ type: 'memory:toggle', open: false });
    await app.until((x) => x.memory === null, 'fechado');
    expect(await app.ui.eval('document.getElementById("memory-panel").hidden')).toBe(true);
    await sleep(2500); // nenhum relatório novo chega
    expect((await app.state()).memory).toBeNull();
  });
});
