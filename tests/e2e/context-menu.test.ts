// Menu de contexto das páginas: clique direito de verdade; os itens são lidos e
// acionados pelo processo principal (o menu nativo não é aberto nos testes).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let page: Cdp;
let main: Cdp;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1' });
  main = await app.main();
  await app.send({ type: 'tab:navigate', url: `${site.url}/ctx` });
  await app.until((s) => app.activeTab(s).title === 'Contexto' && !app.activeTab(s).loading, 'página');
  page = await app.page(`${site.url}/ctx`);
});
afterAll(async () => {
  page?.close();
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

/** Clique direito no elemento e devolve os rótulos do menu montado. */
async function rightClick(selector: string): Promise<string[]> {
  await main.eval(`globalThis.__apolloTest.browser.lastPageMenu = null; true`);
  await page.mouseClick(selector, 'right');
  return waitFor(() => main.eval<string[] | null>(`(() => { const m = globalThis.__apolloTest.browser.lastPageMenu;
    return m && m.items.map((i) => i.type === 'separator' ? '—' : i.label); })()`), 'menu de contexto');
}
const choose = (label: string) => main.eval<boolean>(`globalThis.__apolloTest.browser.lastPageMenu.run(${JSON.stringify(label)})`);

describe('menu de contexto', () => {
  it('link: "Abrir link em segundo plano" cria a aba ao lado, sem trocar', async () => {
    const items = await rightClick('#link');
    expect(items).toContain('Abrir link em nova aba');
    const before = await app.state();
    expect(await choose('Abrir link em segundo plano')).toBe(true);
    const s = await app.until((x) => x.tabs.length === before.tabs.length + 1, 'nova aba');
    expect(s.activeTabId).toBe(before.activeTabId);
    const i = s.tabs.findIndex((t) => t.id === before.activeTabId);
    expect(s.tabs[i + 1].url).toBe(`${site.url}/page?title=Destino`);
  });

  it('"Copiar endereço do link" vai para a área de transferência', async () => {
    await rightClick('#link');
    await choose('Copiar endereço do link');
    expect(await main.eval<string>(`globalThis.__apolloTest.clipboard()`)).toBe(`${site.url}/page?title=Destino`);
  });

  it('imagem e campo de texto têm os itens certos', async () => {
    expect((await rightClick('#img')).slice(0, 2)).toEqual(['Abrir imagem em nova aba', 'Copiar imagem']);
    const field = await rightClick('#campo');
    expect(field).toContain('Colar');
    expect(field).not.toContain('Voltar');
  });

  it('página: "Ver código-fonte" abre view-source numa aba nova', async () => {
    const items = await rightClick('body');
    expect(items.slice(0, 3)).toEqual(['Voltar', 'Avançar', 'Recarregar']);
    await choose('Ver código-fonte');
    // Regressão: a aba guardava a URL sem "view-source:" (e o título "Nova aba").
    const s = await app.until((x) => app.activeTab(x).url === `view-source:${site.url}/ctx`, 'código-fonte');
    expect(app.activeTab(s).title).toBe(`view-source:${site.url}/ctx`);
    const src = await app.page('view-source:');
    expect(await src.eval<boolean>(`document.body.innerText.includes('Universidade Federal')`)).toBe(true);
    src.close();
  });
});
