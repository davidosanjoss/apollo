// Notificações criadas pelo service worker do site (WhatsApp, Teams usam
// registration.showNotification): clicar leva à aba/painel do site. O clique real numa
// notificação do sistema não dá para automatizar; testamos cada pedaço da corrente.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let main: Cdp;
let page: Cdp;
let ws1: string;
let mensageiro: string;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1' });
  main = await app.main();
  await app.send({ type: 'tab:navigate', url: `${site.url}/sw-page` });
  const s = await app.until((x) => app.activeTab(x).title === 'Mensageiro' && !app.activeTab(x).loading, 'mensageiro');
  ws1 = s.activeWorkspaceId;
  mensageiro = s.activeTabId!;
  page = await app.page(`${site.url}/sw-page`);
  await page.eval('window.pronto');
});
afterAll(async () => {
  page?.close();
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

/** Simula o aviso que o preload manda quando o usuário clica (o canal real do service worker). */
const swClick = () => main.eval(`(() => { const b = globalThis.__apolloTest.browser;
  const wc = b.views.get(${JSON.stringify(mensageiro)}).webContents;
  const w = Object.values(wc.session.serviceWorkers.getAllRunning())[0];
  const worker = wc.session.serviceWorkers.getWorkerFromVersionID(Number(Object.keys(wc.session.serviceWorkers.getAllRunning())[0]));
  worker.ipc.emit('apollo:sw-notification-click', {}); return !!w; })()`);

describe('notificações do service worker', () => {
  it('o preload do Apollo está no service worker do site; showNotification funciona', async () => {
    await waitFor(() => main.eval<boolean>(`globalThis.__apolloTest.browser.swPreloaded.has(${JSON.stringify(site.url + '/')})`), 'preload no service worker');
    await app.send({ type: 'permission:set', origin: site.url, kind: 'notifications', decision: 'allow' });
    await page.eval(`window.mandar('mostrar'); true`);
    await waitFor(async () => (await page.eval<string[]>('window.respostas')).includes('ok:mostrar'), 'notificação mostrada');
  });

  it('clique falso disparado pelo próprio service worker não faz nada', async () => {
    await app.send({ type: 'tab:new' });
    const before = (await app.state()).activeTabId;
    await page.eval(`window.mandar('clique-falso'); true`);
    await waitFor(async () => (await page.eval<string[]>('window.respostas')).includes('ok:clique-falso'), 'clique falso');
    await new Promise((r) => setTimeout(r, 500));
    expect((await app.state()).activeTabId).toBe(before);
  });

  it('clique: volta para a aba do site, mesmo estando em outro workspace', async () => {
    await app.send({ type: 'workspace:create', name: 'Outro', color: '#22aa66', home: '' });
    await app.until((s) => s.activeWorkspaceId !== ws1, 'outro workspace');
    expect(await swClick()).toBe(true);
    await app.until((s) => s.activeWorkspaceId === ws1 && s.activeTabId === mensageiro, 'aba do mensageiro');
  });

  it('sem aba do site: abre o painel dele; sem painel: uma aba nova', async () => {
    await main.eval(`globalThis.__apolloTest.browser.showFromServiceWorker(${JSON.stringify(ws1)}, 'http://localhost:1/'); true`);
    await app.until((s) => app.activeTab(s).url.startsWith('http://localhost:1/'), 'aba nova do site');
    await app.send({ type: 'panel:add', url: 'http://localhost:2/', workspaceId: ws1, mobile: false });
    await app.until((s) => s.panels.some((p) => p.url.startsWith('http://localhost:2/')), 'painel');
    await app.send({ type: 'panel:toggle', panelId: (await app.state()).activePanelId! });
    await app.until((s) => s.activePanelId === null, 'painel fechado');
    await main.eval(`globalThis.__apolloTest.browser.showFromServiceWorker(${JSON.stringify(ws1)}, 'http://localhost:2/'); true`);
    await app.until((s) => s.activePanelId !== null, 'painel aberto pelo clique');
  });
});
