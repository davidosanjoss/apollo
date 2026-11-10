// Modo leitura: só o artigo, sem scripts da página; estilo ajustável; sair volta à original.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let main: Cdp;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1' });
  main = await app.main();
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const ui = <T>(js: string) => app.ui.eval<T>(js);
async function open(path: string, title: string) {
  await app.send({ type: 'tab:navigate', url: `${site.url}${path}` });
  await app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, title);
}

describe('modo leitura', () => {
  it('página comum não oferece o modo leitura', async () => {
    await open('/page?title=Comum', 'Comum');
    await new Promise((r) => setTimeout(r, 1200));
    expect((await app.state()).reader.available).toBe(false);
    expect(await ui<boolean>(`document.getElementById('reader-btn').hidden`)).toBe(true);
  });

  it('artigo: o botão aparece; ao entrar, só o artigo (sem menu, anúncio, rodapé)', async () => {
    await open('/article', 'Notícia');
    await app.until((s) => s.reader.available, 'parece artigo');
    await waitFor(() => ui<boolean>(`!document.getElementById('reader-btn').hidden`), 'botão');
    await app.ui.mouseClick('#reader-btn');
    await app.until((s) => s.reader.active, 'em leitura');
    await waitFor(() => ui<boolean>(`!document.getElementById('reader-bar').hidden`), 'barra de leitura');
    const page = await app.page(`${site.url}/article`);
    const text = await page.eval<string>(`document.getElementById('apollo-reader')?.innerText ?? ''`);
    expect(text).toContain('Limites e derivadas');
    expect(text).toContain('Parágrafo 12');
    expect(text).toMatch(/min de leitura/);
    for (const junk of ['COMPRE AGORA', 'Esportes', 'Rodapé do site']) expect(text).not.toContain(junk);
    // Os scripts da página não rodam mais (timer parado; onerror bloqueado pela CSP).
    await new Promise((r) => setTimeout(r, 1000));
    expect(await page.eval<string>('document.body.innerText')).not.toContain('INVADIU');
    expect(await page.eval<string | null>('document.body.dataset.invadiu ?? null')).toBeNull();
    expect(await page.eval<number>(`document.querySelectorAll('#apollo-reader img').length`)).toBeLessThanOrEqual(1);
    page.close();
  });

  it('A+ / tema / fonte mudam a página e ficam salvos', async () => {
    await app.ui.mouseClick('#reader-bigger');
    await ui(`(() => { const t = document.getElementById('reader-theme'); t.value = 'dark'; t.dispatchEvent(new Event('change')); return true; })()`);
    const s = await app.until((x) => x.reader.style.theme === 'dark' && x.reader.style.size === 21, 'estilo');
    expect(s.reader.style.font).toBe('serif');
    const page = await app.page(`${site.url}/article`);
    await waitFor(async () => (await page.eval<string>(`getComputedStyle(document.body).fontSize`)) === '21px', 'tamanho aplicado');
    expect(await page.eval<string>(`getComputedStyle(document.documentElement).backgroundColor`)).toBe('rgb(27, 27, 31)');
    page.close();
  });

  it('F9 sai e a página original volta', async () => {
    await main.eval(`globalThis.__apolloTest.browser.runShortcut('reader'); true`);
    await app.until((s) => !s.reader.active, 'saiu');
    const page = await app.page(`${site.url}/article`);
    await waitFor(async () => { try { return (await page.eval<string>('document.body.innerText')).includes('COMPRE AGORA'); } catch { return false; } }, 'original de volta');
    page.close();
  });
});
