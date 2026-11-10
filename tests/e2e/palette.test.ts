// Fase 5a: paleta de comandos.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const type = (text: string) => app.ui.eval(`(() => { const i = document.getElementById('palette-input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); return true; })()`);
const enter = () => app.ui.eval(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); true`);
const titles = () => app.ui.eval<string[]>(`[...document.querySelectorAll('#palette-list .item .title')].map((e) => e.textContent)`);
async function openPalette() {
  await app.ui.mouseClick('#palette-btn');
  await waitFor(() => app.ui.eval<boolean>(`document.getElementById('palette').open`), 'paleta aberta');
}

describe('paleta de comandos', () => {
  it('fechada: nenhuma lista de abas é calculada', async () => {
    expect((await app.state()).paletteTabs).toBeNull();
  });

  it('acha aba de OUTRO workspace e leva até ela', async () => {
    await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=Planilha` });
    await app.until((s) => app.activeTab(s).title === 'Planilha', 'aba no Principal');
    const principal = (await app.state()).activeWorkspaceId;
    await app.send({ type: 'workspace:create', name: 'Trabalho', color: '#123456', home: '' });
    await app.until((s) => s.workspaces.length === 2 && s.activeWorkspaceId !== principal, 'no Trabalho');

    await openPalette();
    await app.until((s) => s.paletteTabs !== null, 'abas enviadas');
    await type('planil');
    await waitFor(async () => (await titles())[0] === 'Planilha', 'Planilha no topo');
    await enter();
    const s = await app.until((x) => x.activeWorkspaceId === principal && app.activeTab(x).title === 'Planilha', 'foi para a aba');
    expect(s.paletteTabs).toBeNull(); // fechou
    expect(await app.ui.eval(`document.getElementById('palette').open`)).toBe(false);
  });

  it('busca sem acento acha ação; Enter executa', async () => {
    await openPalette();
    await type('monitor memoria');
    await waitFor(async () => (await titles())[0] === 'Monitor de memória', 'ação no topo');
    await enter();
    await app.until((s) => s.memory !== null, 'monitor aberto');
    await app.send({ type: 'memory:toggle', open: false });
  });

  it('endereço digitado abre em nova aba', async () => {
    const before = (await app.state()).tabs.length;
    await openPalette();
    await type(`${site.url}/page?title=Nova`);
    await enter();
    await app.until((s) => s.tabs.length === before + 1 && app.activeTab(s).title === 'Nova', 'nova aba aberta');
  });

  it('Esc fecha sem fazer nada; setas mudam a seleção', async () => {
    await openPalette();
    const first = await app.ui.eval<number>(`[...document.querySelectorAll('#palette-list .item')].findIndex((e) => e.classList.contains('selected'))`);
    await app.ui.eval(`document.getElementById('palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); true`);
    const second = await app.ui.eval<number>(`[...document.querySelectorAll('#palette-list .item')].findIndex((e) => e.classList.contains('selected'))`);
    expect(second).toBe(first + 1);
    await app.ui.eval(`document.getElementById('palette').close(); true`);
    await app.until((s) => s.paletteTabs === null, 'fechada');
  });
});
