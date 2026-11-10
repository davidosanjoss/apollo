// Localizar na página (Ctrl+F): barra na interface, contagem, próximo/anterior, fechar.
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
  await app.send({ type: 'tab:navigate', url: `${site.url}/find` });
  await app.until((s) => app.activeTab(s).title === 'Disciplinas' && !app.activeTab(s).loading, 'página');
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const ui = <T>(js: string) => app.ui.eval<T>(js);
const shortcut = (a: string) => main.eval(`globalThis.__apolloTest.browser.runShortcut(${JSON.stringify(a)}); true`);
const count = () => ui<string>(`document.getElementById('find-count').textContent`);
const type = (text: string) => ui(`(() => { const i = document.getElementById('find-input'); i.value = ${JSON.stringify(text)};
  i.dispatchEvent(new Event('input')); return true; })()`);
const barOpen = () => ui<boolean>(`!document.getElementById('find-bar').hidden`);

describe('localizar na página', () => {
  it('Ctrl+F abre a barra com o foco no campo', async () => {
    await shortcut('find');
    await waitFor(barOpen, 'barra aberta');
    expect(await ui<string>(`document.activeElement.id`)).toBe('find-input');
  });

  it('busca sem diferenciar maiúsculas e conta todos os resultados', async () => {
    await type('cálculo');
    await waitFor(async () => (await count()) === '1 de 3', 'contagem');
  });

  it('Enter/F3 vai ao próximo, Shift+Enter/Shift+F3 volta (dando a volta)', async () => {
    await app.ui.pressEnter('#find-input');
    await waitFor(async () => (await count()) === '2 de 3', 'próximo');
    await shortcut('find-next');
    await waitFor(async () => (await count()) === '3 de 3', 'F3');
    await shortcut('find-next');
    await waitFor(async () => (await count()) === '1 de 3', 'deu a volta');
    await shortcut('find-prev');
    await waitFor(async () => (await count()) === '3 de 3', 'anterior');
  });

  it('sem resultados: avisa e marca o campo', async () => {
    await type('geometria');
    await waitFor(async () => (await count()) === 'Nenhum resultado', 'nenhum');
    expect(await ui<boolean>(`document.getElementById('find-input').classList.contains('none')`)).toBe(true);
  });

  it('Esc fecha a barra e limpa a busca', async () => {
    await ui(`document.getElementById('find-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await waitFor(async () => !(await barOpen()), 'fechou');
    expect((await app.state()).find).toBeNull();
  });

  it('trocar de aba fecha a barra; na página inicial o Ctrl+F não abre', async () => {
    await shortcut('find');
    await waitFor(barOpen, 'aberta');
    await type('linear');
    await waitFor(async () => (await count()) === '1 de 1', 'achou');
    await app.send({ type: 'tab:new' });
    await waitFor(async () => !(await barOpen()), 'fechou ao trocar');
    await shortcut('find');
    await new Promise((r) => setTimeout(r, 300));
    expect(await barOpen()).toBe(false);
  });
});
