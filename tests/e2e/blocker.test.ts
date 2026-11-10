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
  // Regressão: o contador zerava no did-navigate, que em máquina lenta (CI) chegava
  // depois de os bloqueios da página nova já terem sido contados.
  it('padrão: anúncio e rastreador de terceiros não chegam ao servidor', async () => {
    const hit = await loadBlocktest('B1');
    expect(hit).toEqual({ ad: false, tracker: false });
    const s = await app.until((x) => (x.sitePrivacy?.blocked.ads ?? 0) >= 1 && (x.sitePrivacy?.blocked.trackers ?? 0) >= 1, 'contador');
    expect(s.sitePrivacy!.site).toBe('127.0.0.1');
    expect(s.sitePrivacy!.toggles).toMatchObject({ ads: true, trackers: true });
    await waitFor(() => app.ui.eval<boolean>(`!document.getElementById('blocked-count').hidden`), 'contador no botão');
  });

  it('liberar rastreadores neste site: só o rastreador passa', async () => {
    await app.send({ type: 'privacy:set', scope: 'site', feature: 'trackers', enabled: false });
    const hit = await reloadAndCheck('B2');
    expect(hit).toEqual({ ad: false, tracker: true });
    const s = await app.state();
    expect(s.sitePrivacy!.source.trackers).toBe('site');
    expect(s.sitePrivacy!.siteRules).toMatchObject({ ads: null, trackers: false });
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
    expect(after.workspaces.find((w) => w.id === s.activeWorkspaceId)!.privacy).toMatchObject({ ads: false, trackers: null });
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

describe('escudo na barra de endereço', () => {
  const shield = () => app.ui.eval<{ hidden: boolean; cls: string; count: string | null }>(`(() => {
    const b = document.getElementById('shield-btn'); const c = document.getElementById('blocked-count');
    return { hidden: b.hidden, cls: b.className, count: c.hidden ? null : c.textContent };
  })()`);

  it('aparece no site com o estado e o contador; some na página inicial', async () => {
    await app.send({ type: 'tab:new' });
    await app.until((s) => s.sitePrivacy === null, 'página inicial');
    expect((await shield()).hidden).toBe(true);
    await loadBlocktest('S1');
    await waitFor(async () => { const s = await shield(); return !s.hidden && s.count !== null; }, 'escudo com contador');
    // Neste perfil o site tem regras dos testes anteriores: confere o estado que o modelo diz.
    const st = await app.state();
    const expected = st.sitePrivacy!.toggles.ads && st.sitePrivacy!.toggles.trackers ? 'on'
      : !st.sitePrivacy!.toggles.ads && !st.sitePrivacy!.toggles.trackers ? 'off' : 'partial';
    expect((await shield()).cls).toContain(expected);
  });

  it('sobrescrever no domínio muda o escudo; "usar o padrão" desfaz', async () => {
    await app.send({ type: 'privacy:reset-site' });
    await app.until((s) => s.sitePrivacy!.siteRules.ads === null && s.sitePrivacy!.siteRules.trackers === null && !app.activeTab(s).loading, 'padrão');
    const base = await app.state();
    const wsAds = base.sitePrivacy!.toggles.ads;

    await app.send({ type: 'privacy:set', scope: 'site', feature: 'trackers', enabled: false });
    await waitFor(async () => (await shield()).cls.includes(wsAds ? 'partial' : 'off'), 'rastreadores liberados no site');
    await app.send({ type: 'privacy:set', scope: 'site', feature: 'ads', enabled: false });
    await waitFor(async () => (await shield()).cls.includes('off'), 'tudo liberado no site');
    let s = await app.state();
    expect(s.sitePrivacy!.siteRules).toMatchObject({ ads: false, trackers: false });

    await app.send({ type: 'privacy:reset-site' });
    s = await app.until((x) => x.sitePrivacy!.siteRules.ads === null && x.sitePrivacy!.siteRules.trackers === null, 'de volta ao padrão');
    expect(s.sitePrivacy!.toggles.trackers).toBe(true);
  });

  it('clicar no escudo abre o menu sem travar o navegador', async () => {
    await app.ui.mouseClick('#shield-btn');
    await new Promise((r) => setTimeout(r, 300));
    await app.send({ type: 'tab:reload' }); // continua respondendo
    await app.until((s) => !app.activeTab(s).loading, 'responde');
  });
});
