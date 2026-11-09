// Fase 3a: bloqueio de anúncios e rastreadores, em camadas.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, testFilters, waitFor, type TestSite } from './harness';

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

/** Carrega a página de teste e devolve o que chegou ao servidor por causa dela. */
async function loadBlocktest(title: string) {
  site.hits.length = 0;
  await app.send({ type: 'tab:navigate', url: `${site.url}/blocktest?title=${title}` });
  await app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, `carregar ${title}`);
  await new Promise((r) => setTimeout(r, 300));
  return { ad: site.hits.includes('/ads/banner.js'), tracker: site.hits.includes('/track/pixel.gif') };
}

const reloadAndCheck = async (title: string) => {
  site.hits.length = 0;
  // privacy:set recarrega a aba; espera o recarregamento terminar.
  await app.until((s) => !app.activeTab(s).loading, 'recarregou');
  return loadBlocktest(title);
};

describe('bloqueador', () => {
  it('padrão: anúncio e rastreador de terceiros não chegam ao servidor', async () => {
    const hit = await loadBlocktest('B1');
    expect(hit).toEqual({ ad: false, tracker: false });
    const s = await app.until((x) => (x.sitePrivacy?.blocked.ads ?? 0) >= 1 && (x.sitePrivacy?.blocked.trackers ?? 0) >= 1, 'contador');
    expect(s.sitePrivacy!.site).toBe('127.0.0.1');
    expect(s.sitePrivacy!.toggles).toEqual({ ads: true, trackers: true });
    await waitFor(() => app.ui.eval<boolean>(`!document.getElementById('blocked-count').hidden`), 'contador no botão');
  });

  it('liberar rastreadores neste site: só o rastreador passa', async () => {
    await app.send({ type: 'privacy:set', scope: 'site', feature: 'trackers', enabled: false });
    const hit = await reloadAndCheck('B2');
    expect(hit).toEqual({ ad: false, tracker: true });
    const s = await app.state();
    expect(s.sitePrivacy!.source.trackers).toBe('site');
    expect(s.sitePrivacy!.siteRules).toEqual({ ads: null, trackers: false });
  });

  it('regra do site vale só neste workspace (ex.: Outlook do Trabalho × Pessoal)', async () => {
    await app.send({ type: 'workspace:create', name: 'Pessoal', color: '#123456', home: '' });
    await app.until((x) => x.workspaces.length === 2, 'workspace');
    const hit = await loadBlocktest('B3');
    expect(hit).toEqual({ ad: false, tracker: false });
  });

  it('pausar só nesta aba: tudo passa; outra aba do mesmo site continua protegida', async () => {
    await app.send({ type: 'privacy:pause-tab', paused: true });
    let hit = await reloadAndCheck('B4');
    expect(hit).toEqual({ ad: true, tracker: true });
    expect((await app.state()).sitePrivacy!.tabPaused).toBe(true);

    await app.send({ type: 'tab:new' });
    hit = await loadBlocktest('B5');
    expect(hit).toEqual({ ad: false, tracker: false });
  });

  it('padrão do workspace: desligar anúncios no workspace libera em todos os sites dele', async () => {
    const s = await app.state();
    await app.send({ type: 'privacy:set', scope: 'workspace', workspaceId: s.activeWorkspaceId, feature: 'ads', enabled: false });
    const hit = await reloadAndCheck('B6');
    expect(hit).toEqual({ ad: true, tracker: false });
    const after = await app.state();
    expect(after.sitePrivacy!.source.ads).toBe('workspace');
    expect(after.workspaces.find((w) => w.id === s.activeWorkspaceId)!.privacy).toEqual({ ads: false, trackers: null });
  });

  it('regra do site vence a do workspace', async () => {
    await app.send({ type: 'privacy:set', scope: 'site', feature: 'ads', enabled: true });
    const hit = await reloadAndCheck('B7');
    expect(hit).toEqual({ ad: false, tracker: false });
  });

  it('regras salvas sobrevivem ao reinício (a pausa da aba não)', async () => {
    await app.quit();
    app = await Apollo.launch(profile.dir, testFilters(filtersDir));
    const s = await app.state();
    const pessoal = s.workspaces.find((w) => w.name === 'Pessoal')!;
    expect(pessoal.privacy.ads).toBe(false);
    await app.send({ type: 'workspace:switch', workspaceId: s.workspaces.find((w) => w.name === 'Principal')!.id });
    await app.until((x) => x.workspaces.find((w) => w.id === x.activeWorkspaceId)!.name === 'Principal', 'Principal');
    const hit = await loadBlocktest('B8');
    expect(hit).toEqual({ ad: false, tracker: true }); // regra do site (rastreadores liberados) continua
  });
});
