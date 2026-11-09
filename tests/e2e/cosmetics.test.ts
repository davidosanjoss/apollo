// Fase 3b: filtros cosméticos e scriptlets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, testFilters, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let filtersDir: string;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  filtersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-filters-'));
  app = await Apollo.launch(profile.dir, testFilters(filtersDir));
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
  fs.rmSync(filtersDir, { recursive: true, force: true });
});

const display = (page: Cdp, sel: string) =>
  page.eval<string | null>(`(() => { const e = document.querySelector('${sel}'); return e ? getComputedStyle(e).display : null; })()`);

async function openCosmetic(): Promise<Cdp> {
  await app.send({ type: 'tab:navigate', url: `${site.url}/cosmetic?n=${Date.now()}` });
  await app.until((s) => app.activeTab(s).url.includes('/cosmetic') && !app.activeTab(s).loading, 'página');
  return app.page(`${site.url}/cosmetic`);
}

describe('filtros cosméticos e scriptlets', () => {
  it('esconde o anúncio do site, o genérico que aparece depois, e roda o scriptlet antes da página', async () => {
    const page = await openCosmetic();
    await waitFor(async () => (await display(page, '.anuncio')) === 'none', 'anúncio do site escondido');
    expect(await display(page, '#conteudo')).not.toBe('none');
    await waitFor(async () => (await display(page, '.ad-slot-generico')) === 'none', 'anúncio tardio escondido (observador do DOM)');
    expect(await page.eval('document.title')).toBe('scriptlet-ok');
    page.close();
  });

  // Regressão: scriptlets injetados um a um faziam dois json-prune se encadearem
  // (cada um capturava o JSON.parse já interceptado pelo outro) e o player do
  // YouTube não carregava. Agora vão num único script.
  it('vários scriptlets json-prune funcionam juntos', async () => {
    const page = await app.page(`${site.url}/cosmetic`);
    expect(await page.eval('window.prunado')).toBe('{"video":3}');
    page.close();
  });

  it('a página não enxerga nada do preload', async () => {
    const page = await app.page(`${site.url}/cosmetic`);
    expect(await page.eval('typeof require + typeof process + typeof window.ipcRenderer')).toBe('undefinedundefinedundefined');
    page.close();
  });

  it('anúncios liberados no site: nada é escondido nem injetado', async () => {
    await app.send({ type: 'privacy:set', scope: 'site', feature: 'ads', enabled: false });
    await app.until((s) => s.sitePrivacy?.toggles.ads === false && !app.activeTab(s).loading, 'liberado');
    const page = await openCosmetic();
    await waitFor(async () => (await page.eval('document.title')) === 'scriptlet-nao', 'sem scriptlet');
    await new Promise((r) => setTimeout(r, 600));
    expect(await display(page, '.anuncio')).toBe('block');
    expect(await display(page, '.ad-slot-generico')).toBe('block');
    page.close();
  });
});
