// Fase 5c: módulos e personalizações por site.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, sleep, startSite, tempProfile, testFilters, waitFor, type TestSite } from './harness';

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

async function open(base: string, pathname: string) {
  const url = `${base}${pathname}`;
  await app.send({ type: 'tab:navigate', url });
  await app.until((s) => app.activeTab(s).url === url && !app.activeTab(s).loading, `abrir ${url}`);
  return app.page(url);
}

const probe = (page: Awaited<ReturnType<typeof open>>) => page.eval<{ color: string; marca: string | null }>(
  `({ color: getComputedStyle(document.getElementById('alvo')).color, marca: document.body.getAttribute('data-apollo') })`);

describe('personalizações por site', () => {
  it('criar pelo editor: CSS aplicado e JS roda isolado (não vê a página nem o Apollo)', async () => {
    await app.ui.mouseClick('#settings-btn');
    await waitFor(() => app.ui.eval<boolean>(`!document.getElementById('settings-page').hidden`), 'configurações');
    await app.ui.mouseClick('#settings-nav button[data-section="modules"]');
    await waitFor(() => app.ui.eval<boolean>(`!document.querySelector('.settings-section[data-section="modules"]').hidden`), 'módulos');
    await app.ui.mouseClick('#custom-new');
    await app.ui.eval(`(() => {
      document.getElementById('custom-name').value = 'Teste';
      document.getElementById('custom-sites').value = '127.0.0.1';
      document.getElementById('custom-css').value = '#alvo { color: rgb(255, 0, 0) !important; }';
      document.getElementById('custom-js').value = "document.body.setAttribute('data-apollo', [typeof window.segredoDaPagina, typeof require, typeof process, typeof ipcRenderer].join('|'))";
      return true; })()`);
    await app.ui.mouseClick('#custom-save');
    await app.until((s) => s.customizations.length === 1, 'salva');
    await app.ui.mouseClick('#settings-close');

    const page = await open(site.url, '/custom');
    await waitFor(async () => (await probe(page)).marca !== null, 'JS rodou');
    expect(await probe(page)).toEqual({ color: 'rgb(255, 0, 0)', marca: 'undefined|undefined|undefined|undefined' });
    expect(await page.eval('window.segredoDaPagina')).toBe('só da página'); // a página segue intacta
    page.close();
  });

  it('não vale em outro site', async () => {
    const page = await open(site.thirdParty, '/custom');
    await sleep(500);
    expect(await probe(page)).toEqual({ color: 'rgb(0, 0, 0)', marca: null });
    page.close();
  });

  it('módulo "Personalizações" desligado: nada é aplicado', async () => {
    await app.send({ type: 'module:set', moduleId: 'customizations', enabled: false });
    await app.until((s) => s.modules.find((m) => m.id === 'customizations')!.enabled === false, 'desligado');
    const page = await open(site.url, '/custom?2');
    await sleep(500);
    expect(await probe(page)).toEqual({ color: 'rgb(0, 0, 0)', marca: null });
    page.close();
    await app.send({ type: 'module:set', moduleId: 'customizations', enabled: true });
  });
});

describe('módulos', () => {
  it('GPC desligado: o cabeçalho deixa de ser enviado', async () => {
    let page = await open(site.url, '/page?title=GPC');
    expect((await page.eval<Record<string, string>>(`fetch('/headers').then((r) => r.json())`))['sec-gpc']).toBe('1');
    page.close();
    await app.send({ type: 'module:set', moduleId: 'gpc', enabled: false });
    await app.until((s) => s.modules.find((m) => m.id === 'gpc')!.enabled === false, 'desligado');
    page = await open(site.url, '/page?title=GPC2');
    expect((await page.eval<Record<string, string>>(`fetch('/headers').then((r) => r.json())`))['sec-gpc']).toBeUndefined();
    page.close();
  });

  it('filtros cosméticos desligados: o anúncio do site aparece (bloqueio de rede continua)', async () => {
    let page = await open(site.url, '/cosmetic?a');
    await waitFor(async () => (await page.eval<string>(`getComputedStyle(document.querySelector('.anuncio')).display`)) === 'none', 'escondido');
    page.close();
    await app.send({ type: 'module:set', moduleId: 'cosmetics', enabled: false });
    await app.until((s) => s.modules.find((m) => m.id === 'cosmetics')!.enabled === false, 'desligado');
    page = await open(site.url, '/cosmetic?b');
    await sleep(500);
    expect(await page.eval(`getComputedStyle(document.querySelector('.anuncio')).display`)).toBe('block');
    expect(await page.eval('document.title')).toBe('scriptlet-nao');
    page.close();
  });

  it('escolhas dos módulos sobrevivem ao reinício', async () => {
    await app.quit();
    app = await Apollo.launch(profile.dir, testFilters(filtersDir));
    const s = await app.state();
    expect(Object.fromEntries(s.modules.map((m) => [m.id, m.enabled]))).toMatchObject({ gpc: false, cosmetics: false, customizations: true });
    expect(s.customizations.map((c) => c.name)).toEqual(['Teste']);
  });
});
