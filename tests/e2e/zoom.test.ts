// Zoom por site: guardado por workspace, vale para as abas do site, sobrevive ao reinício.
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

const shortcut = (a: string) => main.eval(`globalThis.__apolloTest.browser.runShortcut(${JSON.stringify(a)}); true`);
const zoomLabel = () => app.ui.eval<string | null>(`(() => { const b = document.getElementById('zoom-btn'); return b.hidden ? null : b.textContent; })()`);
async function open(path: string, title: string) {
  await app.send({ type: 'tab:navigate', url: `${site.url}${path}` });
  return app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, title);
}
/** Zoom real da página (o que o site enxerga). */
const pageZoom = async (urlPrefix: string) => {
  const p = await app.page(urlPrefix);
  const z = await p.eval<number>('Math.round(devicePixelRatio * 100)');
  p.close();
  return z;
};

describe('zoom por site', () => {
  it('Ctrl+= / Ctrl+- mudam em degraus e mostram o indicador', async () => {
    await open('/page?title=Um', 'Um');
    expect(await zoomLabel()).toBeNull();
    await shortcut('zoom-in');
    await app.until((s) => s.zoom === 110, '110%');
    await shortcut('zoom-in');
    await app.until((s) => s.zoom === 125, '125%');
    await waitFor(async () => (await zoomLabel()) === '125%', 'indicador');
    expect(await pageZoom(`${site.url}/page?title=Um`)).toBe(125);
    await shortcut('zoom-out');
    await app.until((s) => s.zoom === 110, 'de volta a 110%');
  });

  it('outra página do mesmo site já abre com o zoom; nova aba também', async () => {
    await open('/page?title=Dois', 'Dois');
    await app.until((s) => s.zoom === 110, 'mesmo site');
    await app.send({ type: 'tab:new', url: `${site.url}/page?title=Tres` });
    await app.until((s) => app.activeTab(s).title === 'Tres' && s.zoom === 110, 'nova aba do site');
  });

  it('outro site (localhost ≠ 127.0.0.1) fica em 100%', async () => {
    await app.send({ type: 'tab:navigate', url: site.url.replace('127.0.0.1', 'localhost') + '/page?title=Outro' });
    await app.until((s) => app.activeTab(s).title === 'Outro' && s.zoom === 100, 'outro site');
  });

  it('sobrevive ao reinício', async () => {
    await app.quit();
    app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1' });
    main = await app.main();
    await open('/page?title=Quatro', 'Quatro');
    await app.until((s) => s.zoom === 110, 'zoom guardado');
  });

  it('clicar no indicador volta a 100% (e deixa de guardar)', async () => {
    await waitFor(async () => (await zoomLabel()) === '110%', 'indicador');
    await app.ui.mouseClick('#zoom-btn');
    await app.until((s) => s.zoom === 100, '100%');
    await waitFor(async () => (await zoomLabel()) === null, 'indicador some');
    await open('/page?title=Cinco', 'Cinco');
    expect((await app.state()).zoom).toBe(100);
  });

  it('outro workspace tem o próprio zoom', async () => {
    await shortcut('zoom-in');
    await app.until((s) => s.zoom === 110, '110% no primeiro');
    await app.send({ type: 'workspace:create', name: 'Outro', color: '#22aa66', home: '' });
    await app.until((s) => s.workspaces.length === 2 && s.activeWorkspaceId === s.workspaces[1].id, 'novo workspace');
    await open('/page?title=Seis', 'Seis');
    expect((await app.state()).zoom).toBe(100);
  });
});
