// Nova aba sem processo: a página inicial é desenhada pela interface.
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

const pages = async () => (await app.targets()).filter((t) => t.type === 'page' && !t.url.startsWith('apollo://ui'));
const homeVisible = () => app.ui.eval<boolean>(`!document.getElementById('home-view').hidden`);

describe('página inicial sem processo', () => {
  it('abrir o Apollo e novas abas não criam processos de página', async () => {
    expect(await pages()).toHaveLength(0);
    expect(await homeVisible()).toBe(true);
    for (let i = 0; i < 3; i++) await app.send({ type: 'tab:new' });
    const s = await app.until((x) => x.tabs.length === 4, 'quatro abas');
    expect(s.tabs.every((t) => !t.live && !t.dormant)).toBe(true); // vazias, mas não "hibernadas"
    expect(await pages()).toHaveLength(0);
    expect(await app.ui.eval<number>(`document.querySelectorAll('#tabs .tab.dormant').length`)).toBe(0);
  });

  it('pesquisar na página inicial abre o site (e só então cria o processo)', async () => {
    await app.ui.eval(`(() => { const q = document.getElementById('home-q'); q.value = ${JSON.stringify(`${site.url}/page?title=Achou`)};
      document.getElementById('home-search').requestSubmit(); return true; })()`);
    const s = await app.until((x) => app.activeTab(x).title === 'Achou' && app.activeTab(x).live, 'site aberto');
    expect(app.activeTab(s).canGoBack).toBe(true);
    await waitFor(async () => !(await homeVisible()), 'página inicial some');
    expect((await pages()).map((p) => p.url)).toEqual([`${site.url}/page?title=Achou`]);
  });

  it('"voltar" leva de volta à página inicial', async () => {
    await app.send({ type: 'tab:back' });
    await app.until((x) => app.activeTab(x).url.startsWith('apollo://home'), 'de volta à página inicial');
  });

  it('monitor de memória mostra "página inicial", não "hibernada"', async () => {
    await app.send({ type: 'memory:toggle', open: true });
    await app.until((x) => x.memory !== null, 'monitor');
    const labels = await waitFor(async () => {
      const l = await app.ui.eval<string[]>(`[...document.querySelectorAll('#memory-tabs .mb')].map((e) => e.textContent)`);
      return l.length >= 4 ? l : null;
    }, 'lista');
    expect(labels.filter((l) => l === 'página inicial')).toHaveLength(3);
    expect(labels).not.toContain('hibernada');
    await app.send({ type: 'memory:toggle', open: false });
  });
});
