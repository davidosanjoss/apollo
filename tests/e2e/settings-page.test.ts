// Configurações como página: navegação lateral entre seções; cobre a página do site.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
  await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=Base` });
  await app.until((s) => app.activeTab(s).title === 'Base' && !app.activeTab(s).loading, 'página');
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const ui = <T>(js: string) => app.ui.eval<T>(js);
const pageOpen = () => ui<boolean>(`!document.getElementById('settings-page').hidden`);
const section = () => ui<string>(`[...document.querySelectorAll('.settings-section')].find((s) => !s.hidden)?.dataset.section ?? ''`);
const navActive = () => ui<string>(`document.querySelector('#settings-nav button.active')?.dataset.section ?? ''`);
const siteVisible = async () => (await (await app.page(`${site.url}/page`)).eval<string>('document.visibilityState')) === 'visible';

describe('página de configurações', () => {
  it('abre pelo ⚙ cobrindo a página do site, na primeira seção', async () => {
    await app.ui.mouseClick('#settings-btn');
    await waitFor(pageOpen, 'aberta');
    expect(await section()).toBe('privacy');
    expect(await navActive()).toBe('privacy');
    await waitFor(async () => !(await siteVisible()), 'site escondido');
  });

  it('navegação lateral troca de seção (só uma visível)', async () => {
    for (const s of ['dns', 'history', 'downloads', 'bookmarks', 'languages', 'vault', 'modules', 'about']) {
      await app.ui.mouseClick(`#settings-nav button[data-section="${s}"]`);
      expect(await section()).toBe(s);
      expect(await navActive()).toBe(s);
      expect(await ui<number>(`[...document.querySelectorAll('.settings-section')].filter((x) => !x.hidden).length`)).toBe(1);
    }
    expect(await ui<string>(`document.getElementById('about-version').textContent`)).toMatch(/^Apollo \d+\.\d+\.\d+/);
    expect(await ui<string>(`document.getElementById('about-status').textContent`)).toContain('desenvolvimento');
  });

  it('opções continuam funcionando dentro das seções', async () => {
    await app.ui.mouseClick('#settings-nav button[data-section="downloads"]');
    await app.ui.mouseClick('#download-ask');
    await app.until((s) => s.settings.downloadAsk, 'opção salva');
    await app.ui.mouseClick('#download-ask');
    await app.until((s) => !s.settings.downloadAsk, 'desfeita');
  });

  it('✕ fecha e devolve a página; reabrir volta na última seção', async () => {
    await app.ui.mouseClick('#settings-close');
    await waitFor(async () => !(await pageOpen()), 'fechada');
    await waitFor(siteVisible, 'site visível');
    await app.ui.mouseClick('#settings-btn');
    await waitFor(pageOpen, 'reaberta');
    expect(await section()).toBe('downloads');
  });

  it('trocar de aba fecha as configurações', async () => {
    await app.send({ type: 'tab:new' });
    await waitFor(async () => !(await pageOpen()), 'fechou ao trocar de aba');
  });

  it('Ctrl+K → "Módulos e personalizações" abre direto na seção', async () => {
    await app.ui.mouseClick('#palette-btn');
    await ui(`(() => { const i = document.getElementById('palette-input'); i.value = 'modulos e personalizacoes'; i.dispatchEvent(new Event('input'));
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return true; })()`);
    await waitFor(pageOpen, 'aberta');
    expect(await section()).toBe('modules');
  });
});
