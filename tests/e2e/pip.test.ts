// Vídeo flutuante (picture-in-picture): botão, botão direito, fechar pelo próprio vídeo,
// automático ao trocar de aba.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let main: Cdp;
let page: Cdp;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1' });
  main = await app.main();
  await app.send({ type: 'tab:navigate', url: `${site.url}/video` });
  await app.until((s) => app.activeTab(s).title === 'Video' && !app.activeTab(s).loading, 'vídeo');
  page = await app.page(`${site.url}/video`);
});
afterAll(async () => {
  page?.close();
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const floating = () => page.eval<boolean>('!!document.pictureInPictureElement');
const btnShown = () => app.ui.eval<boolean>(`!document.getElementById('pip-btn').hidden`);

describe('vídeo flutuante', () => {
  it('botão aparece quando a página tem vídeo; clicar põe o vídeo flutuando', async () => {
    await app.until((s) => s.pip.available, 'vídeo detectado');
    await waitFor(btnShown, 'botão visível');
    await app.ui.mouseClick('#pip-btn');
    await app.until((s) => s.pip.active, 'flutuando');
    expect(await floating()).toBe(true);
  });

  it('fechar pelo próprio vídeo flutuante: o Apollo percebe', async () => {
    await page.eval('document.exitPictureInPicture().then(() => true)');
    await app.until((s) => !s.pip.active, 'fechado');
  });

  it('botão direito no vídeo → "Vídeo flutuante"; de novo pelo botão fecha', async () => {
    await main.eval(`globalThis.__apolloTest.browser.lastPageMenu = null; true`);
    await page.mouseClick('video', 'right');
    await waitFor(() => main.eval<boolean>(`!!globalThis.__apolloTest.browser.lastPageMenu`), 'menu');
    expect(await main.eval<boolean>(`globalThis.__apolloTest.browser.lastPageMenu.run('Vídeo flutuante (picture-in-picture)')`)).toBe(true);
    await app.until((s) => s.pip.active, 'flutuando pelo menu');
    await app.send({ type: 'tab:pip' });
    await app.until((s) => !s.pip.active, 'fechado pelo botão');
    expect(await floating()).toBe(false);
  });

  it('sem a opção, trocar de aba não faz flutuar; com ela, faz', async () => {
    await app.send({ type: 'tab:new' });
    await new Promise((r) => setTimeout(r, 800));
    expect(await floating()).toBe(false);
    const s0 = await app.state();
    const videoTab = s0.tabs.find((t) => t.title === 'Video')!.id;
    await app.send({ type: 'tab:activate', tabId: videoTab });
    await app.send({ type: 'settings:auto-pip', on: true });
    await app.until((s) => s.settings.autoPip && s.activeTabId === videoTab, 'opção ligada');
    await app.send({ type: 'tab:new' });
    await waitFor(floating, 'flutuou ao trocar de aba');
  });
});
