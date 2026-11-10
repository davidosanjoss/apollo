// Tela cheia (vídeo e F11), ferramentas do desenvolvedor.
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
  await app.send({ type: 'tab:navigate', url: `${site.url}/fs` });
  await app.until((s) => app.activeTab(s).title === 'Player' && !app.activeTab(s).loading, 'player');
  page = await app.page(`${site.url}/fs`);
});
afterAll(async () => {
  page?.close();
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const shortcut = (a: string) => main.eval(`globalThis.__apolloTest.browser.runShortcut(${JSON.stringify(a)}); true`);
/** Tamanho da página vs. da janela (a interface ocupa a janela inteira). */
const sizes = async () => ({
  page: await page.eval<[number, number]>('[innerWidth, innerHeight]'),
  win: await app.ui.eval<[number, number]>('[innerWidth, innerHeight]'),
});

describe('tela cheia', () => {
  // Regressão: o vídeo em tela cheia ficava preso no espaço da aba (com abas, barra e
  // lateral visíveis), porque a view nativa mantinha os limites de antes.
  it('vídeo em tela cheia cobre a janela inteira; ao sair, volta ao espaço da aba', async () => {
    const normal = await sizes();
    expect(normal.page[0]).toBeLessThan(normal.win[0]);
    await page.mouseClick('#cheia'); // gesto do usuário
    await app.until((s) => s.fullscreen === 'page', 'tela cheia da página');
    await waitFor(async () => { const z = await sizes(); return z.page[0] === z.win[0] && z.page[1] === z.win[1]; }, 'página cobre a janela');
    await page.eval('document.exitFullscreen().then(() => true)');
    await app.until((s) => s.fullscreen === null, 'saiu');
    await waitFor(async () => (await sizes()).page[0] === normal.page[0], 'voltou ao espaço da aba');
  });

  it('F11 esconde a interface (só a página) e mostra como sair; F11 de novo volta', async () => {
    await shortcut('fullscreen');
    await app.until((s) => s.fullscreen === 'window', 'F11');
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('toolbar').offsetParent === null
      && document.getElementById('sidebar').offsetParent === null && !document.getElementById('fullscreen-hint').hidden`), 'interface escondida');
    await waitFor(async () => { const z = await sizes(); return z.page[0] === z.win[0]; }, 'página na largura toda');
    await shortcut('fullscreen');
    await app.until((s) => s.fullscreen === null, 'saiu do F11');
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('toolbar').offsetParent !== null`), 'interface de volta');
  });
});

describe('ferramentas do desenvolvedor', () => {
  it('F12 abre (janela própria) e fecha', async () => {
    const devtools = async () => (await app.targets()).some((t) => t.url.startsWith('devtools://'));
    // O alvo devtools:// aparece antes de isDevToolsOpened() ficar verdadeiro: espera os dois.
    const opened = () => main.eval<boolean>(`[...globalThis.__apolloTest.browser.views.values()][0].webContents.isDevToolsOpened()`);
    await shortcut('devtools');
    await waitFor(async () => (await devtools()) && (await opened()), 'devtools aberto');
    await shortcut('devtools');
    await waitFor(async () => !(await devtools()), 'devtools fechado');
  });
});
