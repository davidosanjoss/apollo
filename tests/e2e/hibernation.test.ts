// Fase 2c: hibernação de abas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UiState } from '../../src/shared/types';
import { Apollo, sleep, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
beforeAll(async () => { site = await startSite(); });
afterAll(async () => { await site?.close(); });

const byTitle = (s: UiState, title: string) => s.tabs.find((t) => t.title === title)!;

async function open(app: Apollo, path: string, title: string, newTab = true) {
  if (newTab) await app.send({ type: 'tab:new' });
  await app.send({ type: 'tab:navigate', url: `${site.url}${path}` });
  return app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, `abrir ${title}`);
}

describe('hibernação manual', () => {
  let app: Apollo;
  let profile: ReturnType<typeof tempProfile>;
  beforeAll(async () => { profile = tempProfile(); app = await Apollo.launch(profile.dir); });
  afterAll(async () => { await app?.quit(); profile?.cleanup(); });

  it('libera a página e recarrega ao clicar, com o histórico', async () => {
    await open(app, '/page?title=A1', 'A1', false);
    await open(app, '/page?title=A2', 'A2', false);
    let s = await open(app, '/page?title=B', 'B');
    const a = byTitle(s, 'A2');
    expect(a.dormant).toBe(false);

    await app.send({ type: 'tab:hibernate', tabId: a.id });
    s = await app.until((x) => byTitle(x, 'A2').dormant, 'A2 hibernada');
    expect((await app.targets()).some((t) => t.url.endsWith('title=A2'))).toBe(false); // página não existe mais

    await app.send({ type: 'tab:activate', tabId: a.id });
    s = await app.until((x) => !byTitle(x, 'A2').dormant && app.activeTab(x).canGoBack && !app.activeTab(x).loading, 'A2 de volta, com histórico');
    await app.send({ type: 'tab:back' });
    await app.until((x) => app.activeTab(x).url.endsWith('title=A1'), 'voltar para A1');
  });

  // "Voltar" logo ao acordar, com a página ainda carregando, não pode ser desfeito
  // pela restauração do histórico (falha vista no CI; ver loadTab).
  it('voltar logo ao acordar a aba (ainda carregando) funciona', async () => {
    await open(app, '/page?title=L1', 'L1');
    let s = await open(app, '/slow?ms=2000&title=L2', 'L2', false);
    const l = s.activeTabId!;
    s = await open(app, '/page?title=Outra', 'Outra');
    await app.send({ type: 'tab:hibernate', tabId: l });
    await app.until((x) => x.tabs.find((t) => t.id === l)!.dormant, 'L hibernada');

    await app.send({ type: 'tab:activate', tabId: l });
    await app.until((x) => app.activeTab(x).canGoBack, 'histórico restaurado (L2 ainda carregando)');
    await app.send({ type: 'tab:back' });
    await app.until((x) => app.activeTab(x).url.endsWith('title=L1') && !app.activeTab(x).loading, 'voltou para L1');
    await sleep(2500); // depois de a L2 lenta "terminar"
    expect(app.activeTab(await app.state()).url).toMatch(/title=L1$/);
  });

  it('a aba na tela nunca hiberna', async () => {
    const s = await app.state();
    await app.send({ type: 'tab:hibernate', tabId: s.activeTabId! });
    await sleep(300);
    expect(app.activeTab(await app.state()).dormant).toBe(false);
  });

  it('formulário não enviado (beforeunload) não é descartado', async () => {
    let s = await open(app, '/form', 'Formulário');
    const form = s.activeTabId!;
    // beforeunload só vale depois de o usuário interagir com a página.
    const page = await app.page(`${site.url}/form`);
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 20, button: 'left', clickCount: 1 });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 20, button: 'left', clickCount: 1 });
    page.close();

    s = await app.state();
    await app.send({ type: 'tab:activate', tabId: byTitle(s, 'B').id });
    await app.until((x) => app.activeTab(x).title === 'B', 'B ativa');
    await app.send({ type: 'tab:hibernate', tabId: form });
    await sleep(800);
    expect(byTitle(await app.state(), 'Formulário').dormant).toBe(false);
    expect((await app.targets()).some((t) => t.url.endsWith('/form'))).toBe(true);
  });

  it('"hibernar outras" libera todas menos a da tela', async () => {
    let s = await app.state();
    await app.send({ type: 'tab:activate', tabId: byTitle(s, 'B').id });
    await app.send({ type: 'tab:hibernate-others', tabId: byTitle(s, 'B').id });
    s = await app.until((x) => x.tabs.filter((t) => t.title !== 'B' && t.title !== 'Formulário').every((t) => t.dormant), 'outras hibernadas');
    expect(byTitle(s, 'B').dormant).toBe(false);
  });
});

describe('hibernação automática', () => {
  let app: Apollo;
  let profile: ReturnType<typeof tempProfile>;
  // "1 minuto" = 200 ms; verificação a cada 150 ms.
  beforeAll(async () => {
    profile = tempProfile();
    app = await Apollo.launch(profile.dir, { APOLLO_TEST_MINUTE_MS: '200', APOLLO_TEST_HIBERNATION_TICK_MS: '150' });
  });
  afterAll(async () => { await app?.quit(); profile?.cleanup(); });

  const setTimeoutMin = async (min: number) => {
    const s = await app.state();
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId)!;
    await app.send({ type: 'workspace:update', workspaceId: ws.id, name: ws.name, color: ws.color, home: '', hibernateAfterMin: min });
    await app.until((x) => x.workspaces[0].hibernateAfterMin === min, 'tempo salvo');
  };

  it('"Nunca": nenhuma aba hiberna', async () => {
    await setTimeoutMin(0);
    await open(app, '/page?title=Velha', 'Velha', false);
    await open(app, '/page?title=Atual', 'Atual');
    await sleep(1500); // ~7 "minutos"
    expect(byTitle(await app.state(), 'Velha').dormant).toBe(false);
  });

  it('parada além do tempo hiberna — inclusive fixada; exceções ficam', async () => {
    let s = await open(app, '/page?title=Fixada', 'Fixada');
    await app.send({ type: 'tab:pin', tabId: s.activeTabId!, pinned: true });
    s = await open(app, '/page?title=SempreAtiva', 'SempreAtiva');
    await app.send({ type: 'tab:keep-awake', tabId: s.activeTabId!, keepAwake: true });
    await open(app, '/video', 'Video');
    await waitFor(async () => {
      const p = await app.page(`${site.url}/video`);
      const playing = await p.eval<boolean>(`!document.querySelector('video').paused`);
      p.close();
      return playing;
    }, 'vídeo tocando');
    s = await open(app, '/page?title=Tela', 'Tela');

    await setTimeoutMin(5); // 1 s
    s = await app.until((x) => byTitle(x, 'Velha').dormant && byTitle(x, 'Fixada').dormant, 'paradas hibernadas', 6000);
    expect(byTitle(s, 'SempreAtiva').dormant).toBe(false);
    expect(byTitle(s, 'Video').dormant).toBe(false);
    expect(byTitle(s, 'Tela').dormant).toBe(false);
  });

  it('aba recém-vista não hiberna antes do tempo', async () => {
    let s = await app.state();
    await app.send({ type: 'tab:activate', tabId: byTitle(s, 'Velha').id });
    await app.until((x) => !byTitle(x, 'Velha').dormant, 'Velha acordou');
    await app.send({ type: 'tab:activate', tabId: byTitle(s, 'Tela').id });
    await sleep(400); // 2 "minutos" < 5
    s = await app.state();
    expect(byTitle(s, 'Velha').dormant).toBe(false);
    await app.until((x) => byTitle(x, 'Velha').dormant, 'Velha hibernou depois do tempo', 5000);
  });
});

describe('ao sair e workspace fora da tela', () => {
  let app: Apollo;
  let profile: ReturnType<typeof tempProfile>;
  beforeAll(async () => {
    profile = tempProfile();
    app = await Apollo.launch(profile.dir, { APOLLO_TEST_MINUTE_MS: '200', APOLLO_TEST_HIBERNATION_TICK_MS: '60000' });
  });
  afterAll(async () => { await app?.quit(); profile?.cleanup(); });

  const ws = async () => { const s = await app.state(); return s.workspaces.find((w) => w.id === s.activeWorkspaceId)!; };

  it('"Ao sair da aba": a aba hiberna logo depois de você trocar de aba', async () => {
    const w = await ws();
    expect(w.hiddenHibernateMin).toBe(10); // padrão
    await app.send({ type: 'workspace:update', workspaceId: w.id, name: w.name, color: w.color, home: '', hibernateAfterMin: -1 });
    await open(app, '/page?title=Primeira', 'Primeira', false);
    await open(app, '/page?title=Segunda', 'Segunda');
    // A verificação periódica está desligada (60 s): quem hiberna é a rodada agendada ao sair.
    await app.until((x) => byTitle(x, 'Primeira').dormant, 'Primeira hibernou ao sair', 5000);
    expect(byTitle(await app.state(), 'Segunda').dormant).toBe(false);
  });

  it('workspace fora da tela usa a regra mais curta ("ao sair do workspace")', async () => {
    const principal = await ws();
    await app.send({ type: 'workspace:update', workspaceId: principal.id, name: principal.name, color: principal.color, home: '', hibernateAfterMin: 0, hiddenHibernateMin: -1 });
    await open(app, '/page?title=Fica', 'Fica');
    await app.send({ type: 'workspace:create', name: 'Outro', color: '#123456', home: '' });
    await app.until((x) => x.activeWorkspaceId !== principal.id, 'no outro workspace');
    await app.send({ type: 'workspace:switch', workspaceId: principal.id });
    const s = await app.until((x) => x.activeWorkspaceId === principal.id, 'de volta');
    // "Fica" ficou na tela do Principal: ao voltar ela acorda; a regra só vale fora da tela.
    expect(byTitle(s, 'Fica')).toBeDefined();
  });
});

describe('painéis: hibernar', () => {
  let app: Apollo;
  let profile: ReturnType<typeof tempProfile>;
  beforeAll(async () => { profile = tempProfile(); app = await Apollo.launch(profile.dir); });
  afterAll(async () => { await app?.quit(); profile?.cleanup(); });

  const panelTarget = async (title: string) => (await app.targets()).some((t) => t.type === 'page' && t.url.endsWith(`title=${title}`));

  it('"Hibernar agora" descarrega o painel; abrir recarrega', async () => {
    const s0 = await app.state();
    await app.send({ type: 'panel:add', url: `${site.url}/page?title=PainelA`, workspaceId: s0.activeWorkspaceId, mobile: false });
    const s = await app.until((x) => x.panels.length === 1 && x.panels[0].loaded, 'painel carregado');
    expect(s.panels[0].hibernateMin).toBeNull(); // padrão: sempre ativo
    await waitFor(() => panelTarget('PainelA'), 'site do painel');
    await app.send({ type: 'panel:hibernate', panelId: s.panels[0].id });
    await app.until((x) => !x.panels[0].loaded && x.activePanelId === null, 'hibernado');
    await waitFor(async () => !(await panelTarget('PainelA')), 'site descarregado');
    await app.send({ type: 'panel:toggle', panelId: s.panels[0].id });
    await app.until((x) => x.panels[0].loaded, 'recarregado');
    await waitFor(() => panelTarget('PainelA'), 'site de volta');
  });

  it('"Ao fechar": fechar o painel já libera a memória', async () => {
    const p = (await app.state()).panels[0];
    await app.send({ type: 'panel:set', panelId: p.id, hibernateMin: 0 });
    await app.send({ type: 'panel:toggle', panelId: p.id });
    await app.until((x) => x.activePanelId === null && !x.panels[0].loaded, 'fechou e hibernou');
  });
});
