// Histórico de visitas: pesquisável no Ctrl+K, por workspace, desligável e apagável.
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

const ui = <T>(js: string) => app.ui.eval<T>(js);
async function visit(title: string) {
  await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=${encodeURIComponent(title)}` });
  await app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, title);
}
/** Abre a paleta, digita e devolve os títulos do grupo Histórico. */
async function searchHistory(q: string, expectCount: number): Promise<string[]> {
  await ui(`(() => { const p = document.getElementById('palette'); if (!p.open) document.getElementById('palette-btn').click();
    const i = document.getElementById('palette-input'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return true; })()`);
  return waitFor(async () => {
    const t = await ui<string[]>(`(() => { const out = []; let g = '';
      for (const li of document.querySelectorAll('#palette-list li')) {
        if (li.classList.contains('group')) g = li.textContent; else if (g === 'Histórico') out.push(li.querySelector('.title').textContent);
      } return out; })()`);
    return t.length === expectCount ? t : null;
  }, `histórico com ${expectCount} itens para "${q}"`);
}
const closePalette = () => ui(`document.getElementById('palette').close(); true`);

describe('histórico', () => {
  it('páginas visitadas aparecem no Ctrl+K (sem acento, palavras em qualquer ordem)', async () => {
    await visit('Cálculo Diferencial');
    await visit('Álgebra Linear');
    await visit('Início'); // nenhuma das duas fica aberta numa aba (aba aberta não repete no histórico)
    await app.send({ type: 'tab:new' });
    expect(await searchHistory('diferencial calculo', 1)).toEqual(['Cálculo Diferencial']);
    expect(await searchHistory('algebra', 1)).toEqual(['Álgebra Linear']);
  });

  it('escolher abre na própria aba (estava na página inicial)', async () => {
    const before = await app.state();
    await app.ui.pressEnter('#palette-input');
    const s = await app.until((x) => app.activeTab(x).title === 'Álgebra Linear', 'abriu');
    expect(s.tabs).toHaveLength(before.tabs.length);
    expect(s.activeTabId).toBe(before.activeTabId);
  });

  it('workspace temporário não guarda; outro workspace não vê', async () => {
    await app.send({ type: 'workspace:create', name: 'Anônimo', color: '#888888', home: '', temporary: true });
    await app.until((s) => s.workspaces.length === 2 && s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.temporary, 'temporário');
    await visit('Segredo');
    expect(await searchHistory('calculo', 0)).toEqual([]); // histórico é do outro workspace
    expect(await searchHistory('segredo', 0)).toEqual([]);
    await closePalette();
  });

  it('desligado: não guarda novas visitas', async () => {
    const first = (await app.state()).workspaces.find((w) => !w.temporary)!;
    await app.send({ type: 'workspace:switch', workspaceId: first.id });
    await app.send({ type: 'settings:history', on: false });
    await app.until((s) => !s.settings.historyOn, 'desligado');
    await visit('Geometria');
    await app.send({ type: 'tab:new' });
    expect(await searchHistory('geometria', 0)).toEqual([]);
    await app.send({ type: 'settings:history', on: true });
    await app.until((s) => s.settings.historyOn, 'religado');
  });

  it('"Apagar todo o histórico" apaga', async () => {
    expect(await searchHistory('calculo', 1)).toHaveLength(1);
    await closePalette();
    await app.send({ type: 'history:clear' });
    expect(await searchHistory('calculo', 0)).toEqual([]);
    await closePalette();
  });
});
