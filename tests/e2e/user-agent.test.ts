// Regressão: o login do Google recusava o Apollo ("This browser or app may not be secure").
// Com o user agent trocado, as client hints sumiam (navigator.userAgentData vazio e sem
// sec-ch-ua). Agora a página vê um Chromium comum.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, type TestSite } from './harness';

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

describe('identificação do navegador', () => {
  it('aba: user agent limpo, marcas no JavaScript e nos cabeçalhos', async () => {
    await app.send({ type: 'tab:navigate', url: `${site.url}/headers` });
    await app.until((s) => app.activeTab(s).url.includes('/headers') && !app.activeTab(s).loading, 'página');
    const page = await app.page(`${site.url}/headers`);
    const r = await page.eval<{ ua: string; brands: string[]; full: string[]; headers: Record<string, string> }>(`(async () => ({
      ua: navigator.userAgent, brands: navigator.userAgentData.brands.map((b) => b.brand),
      full: (await navigator.userAgentData.getHighEntropyValues(['fullVersionList'])).fullVersionList.map((b) => b.version),
      headers: JSON.parse(document.body.innerText) }))()`);
    page.close();
    expect(r.ua).not.toMatch(/Electron|apollo/i);
    expect(r.brands).toContain('Chromium');
    expect(r.full[0]).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(r.headers['sec-ch-ua']).toContain('"Chromium";v="');
    expect(r.headers['sec-ch-ua-platform']).toBeTruthy();
  });

  it('painel "versão para celular": identifica-se como celular', async () => {
    const s = await app.state();
    await app.send({ type: 'panel:add', url: `${site.url}/headers?p=1`, workspaceId: s.activeWorkspaceId, mobile: true });
    const panel = await app.page(`${site.url}/headers?p=1`);
    const r = await panel.eval<{ mobile: boolean; ua: string }>(`({ mobile: navigator.userAgentData.mobile, ua: navigator.userAgent })`);
    panel.close();
    expect(r.mobile).toBe(true);
    expect(r.ua).toContain('Android');
  });
});
