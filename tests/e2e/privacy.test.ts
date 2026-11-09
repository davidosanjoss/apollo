// Fase 3c: cookies de terceiros e limpeza de URL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, sleep, startSite, tempProfile, type TestSite } from './harness';

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

async function go(url: string, until: (u: string) => boolean = (u) => u === url) {
  await app.send({ type: 'tab:navigate', url });
  return app.until((s) => until(app.activeTab(s).url) && !app.activeTab(s).loading, `navegar ${url}`);
}

describe('limpeza de URL', () => {
  it('link com utm_/fbclid abre sem eles', async () => {
    const s = await go(`${site.url}/page?title=Limpa&id=7&utm_source=insta&fbclid=abc`, (u) => u.includes('title=Limpa'));
    expect(app.activeTab(s).url).toBe(`${site.url}/page?title=Limpa&id=7`);
  });

  it('liberado no site: link fica como está', async () => {
    await app.send({ type: 'privacy:set', scope: 'site', feature: 'urlCleaning', enabled: false });
    await app.until((s) => s.sitePrivacy?.toggles.urlCleaning === false, 'regra');
    const s = await go(`${site.url}/page?title=Suja&utm_source=x`, (u) => u.includes('title=Suja'));
    expect(app.activeTab(s).url).toBe(`${site.url}/page?title=Suja&utm_source=x`);
    await app.send({ type: 'privacy:set', scope: 'site', feature: 'urlCleaning', enabled: null });
  });
});

describe('cookies de terceiros', () => {
  it('cookie de localhost não vai junto quando a página é 127.0.0.1 (terceiro)', async () => {
    // Primeira parte: o próprio localhost grava o cookie.
    await go(`${site.thirdParty}/set-cookie-3p?v=meu`);
    await go(`${site.thirdParty}/cookie`);
    expect(site.cookies.get('/cookie')).toContain('tp=meu');

    // Terceira parte: 127.0.0.1 carrega imagem de localhost.
    site.cookies.delete('/pixel');
    await go(`${site.url}/embed?title=E1`, (u) => u.includes('title=E1'));
    await sleep(300);
    expect(site.cookies.get('/pixel')).toBe('');
  });

  it('terceiro também não consegue GRAVAR cookie', async () => {
    await go(`${site.url}/embed?title=E2&src=${encodeURIComponent('/set-cookie-3p?v=pelo-terceiro')}`, (u) => u.includes('title=E2'));
    await sleep(300);
    await go(`${site.thirdParty}/cookie`);
    expect(site.cookies.get('/cookie')).toContain('tp=meu');
    expect(site.cookies.get('/cookie')).not.toContain('pelo-terceiro');
  });

  it('liberar cookies de terceiros no site: o cookie volta a ir', async () => {
    await go(`${site.url}/embed?title=E3`, (u) => u.includes('title=E3'));
    await app.send({ type: 'privacy:set', scope: 'site', feature: 'thirdPartyCookies', enabled: false });
    await app.until((s) => s.sitePrivacy?.toggles.thirdPartyCookies === false && !app.activeTab(s).loading, 'liberado');
    site.cookies.delete('/pixel');
    await go(`${site.url}/embed?title=E4`, (u) => u.includes('title=E4'));
    await sleep(300);
    expect(site.cookies.get('/pixel')).toContain('tp=meu');
  });
});
