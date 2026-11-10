// Regressão (relatado): Ctrl+R num terminal web (ai-office) recarregava a página em vez de
// abrir a busca no histórico de comandos. Como no Chrome, a página recebe primeiro os atalhos
// não reservados; se não usar, o Apollo age.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

async function open(path: string, title: string) {
  await app.send({ type: 'tab:navigate', url: `${site.url}${path}` });
  await app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, title);
  const page = await app.page(`${site.url}${path}`);
  await page.eval('window.marca = 1; true');
  return page;
}

describe('atalhos que a página recebe primeiro', () => {
  it('terminal web: Ctrl+R vai para a página (busca no histórico), sem recarregar', async () => {
    const page = await open('/terminal', 'Terminal');
    await page.mouseClick('#saida');
    await page.pressKey('r');
    await waitFor(async () => (await page.eval<string[]>('window.log')).includes('busca-reversa'), 'página recebeu');
    await new Promise((r) => setTimeout(r, 800));
    expect(await page.eval<number>('window.marca')).toBe(1); // não recarregou
    page.close();
  });

  it('página comum: Ctrl+R recarrega (ninguém usou a tecla)', async () => {
    const page = await open('/page?title=Comum', 'Comum');
    await page.mouseClick('body');
    await page.pressKey('r');
    await waitFor(async () => { try { return (await page.eval<number | undefined>('window.marca')) === undefined; } catch { return false; } }, 'recarregou');
    page.close();
  });

  it('página comum: Ctrl+F abre a busca do Apollo', async () => {
    const page = await app.page(`${site.url}/page?title=Comum`);
    await page.mouseClick('body');
    await page.pressKey('f');
    await waitFor(() => app.ui.eval<boolean>(`!document.getElementById('find-bar').hidden`), 'barra de busca');
    await app.ui.eval(`document.getElementById('find-close').click(); true`);
    page.close();
  });

  it('evento falso criado pelo site não faz o Apollo agir', async () => {
    const page = await open('/page?title=Falso', 'Falso');
    await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true })); true`);
    await new Promise((r) => setTimeout(r, 800));
    expect(await page.eval<number>('window.marca')).toBe(1);
    page.close();
  });
});
