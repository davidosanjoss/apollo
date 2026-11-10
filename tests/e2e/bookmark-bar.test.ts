// Barra de favoritos por workspace: pastas, subpastas, menus nativos, arrastar, gerenciador.
// Também: ferramentas no rodapé da barra direita e a janela de histórico.
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

const ui = <T>(js: string) => app.ui.eval<T>(js);
const bar = () => ui<string[]>(`[...document.querySelectorAll('#bookmark-items .bm')].filter((b) => !b.hidden).map((b) => b.textContent)`);
const menuLabels = (path: string[] = []) => main.eval<string[]>(`(() => { let items = globalThis.__apolloTest.browser.lastMenu;
  for (const l of ${JSON.stringify(path)}) items = items.find((i) => i.label === l).submenu;
  return items.map((i) => i.type === 'separator' ? '—' : i.label); })()`);
const clickMenu = (path: string[]) => main.eval<boolean>(`(() => { let items = globalThis.__apolloTest.browser.lastMenu; let it;
  for (const l of ${JSON.stringify(path)}) { it = items.find((i) => i.label === l); if (!it) return false; items = it.submenu; }
  it.click(); return true; })()`);
const dialogOpen = (id: string) => ui<boolean>(`document.getElementById('${id}').open`);
async function open(title: string) {
  await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=${encodeURIComponent(title)}` });
  await app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, title);
}
async function star(title: string) {
  await open(title);
  await app.send({ type: 'bookmark:add' });
  await app.until((s) => s.bookmarks.some((b) => b.title === title), `favorito ${title}`);
}
async function dialogSubmit(name: string, folderLabel?: string) {
  await waitFor(() => dialogOpen('bookmark-dialog'), 'diálogo');
  await ui(`(() => { document.getElementById('bookmark-title').value = ${JSON.stringify(name)};
    ${folderLabel ? `const sel = document.getElementById('bookmark-folder');
      sel.value = [...sel.options].find((o) => o.textContent.trim() === ${JSON.stringify(folderLabel)}).value;` : ''}
    document.getElementById('bookmark-form').requestSubmit(); return true; })()`);
  await waitFor(async () => !(await dialogOpen('bookmark-dialog')), 'diálogo fechou');
}
/** Arrastar do HTML5 (o mouse do CDP não inicia drag-and-drop), soltando a `ratio` da largura do alvo. */
const dragTo = (from: string, to: string, ratio: number) => ui(`(() => {
  const a = document.querySelector(${JSON.stringify(from)}), b = document.querySelector(${JSON.stringify(to)});
  const r = b.getBoundingClientRect(); const dt = new DataTransfer();
  const ev = (type, el) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: r.left + r.width * ${ratio}, clientY: r.top + r.height / 2 }));
  ev('dragstart', a); ev('dragover', b); ev('drop', b); ev('dragend', a); return true; })()`);
const id = async (title: string) => (await app.state()).bookmarks.find((b) => b.title === title)!.id;

describe('barra de favoritos', () => {
  it('aparece vazia com uma dica; favoritar põe na barra', async () => {
    expect(await ui<boolean>(`!document.getElementById('bookmark-bar').hidden`)).toBe(true);
    expect(await ui<string>(`document.querySelector('#bookmark-bar .empty').textContent`)).toContain('favoritos aparecem aqui');
    await star('Moodle');
    await star('Outlook');
    await waitFor(async () => (await bar()).map((t) => t.slice(1)).join() === 'Moodle,Outlook', 'na barra'); // 1º caractere = ícone (inicial)
  });

  it('botão direito na barra → "Nova pasta…" → nome → pasta na barra', async () => {
    await app.send({ type: 'bookmark:context', bookmarkId: null, x: 100, y: 100 });
    expect(await menuLabels()).toContain('Nova pasta…');
    await clickMenu(['Nova pasta…']);
    await dialogSubmit('Faculdade');
    await waitFor(async () => (await bar()).some((t) => t.includes('Faculdade')), 'pasta na barra');
    expect((await app.state()).bookmarks.find((b) => b.title === 'Faculdade')).toMatchObject({ folder: true, parentId: null });
  });

  it('subpasta pelo gerenciador (＋ na pasta)', async () => {
    await app.send({ type: 'bookmark:context', bookmarkId: null, x: 100, y: 100 });
    await clickMenu(['Gerenciar favoritos…']);
    await waitFor(() => dialogOpen('bookmarks-manager'), 'gerenciador');
    const fac = await id('Faculdade');
    await app.ui.mouseClick(`#bm-tree li[data-bookmark-id="${fac}"] > .row button[title="Nova subpasta"]`);
    await dialogSubmit('Cálculo');
    const s = await app.until((x) => x.bookmarks.some((b) => b.title === 'Cálculo'), 'subpasta');
    expect(s.bookmarks.find((b) => b.title === 'Cálculo')!.parentId).toBe(fac);
    await waitFor(() => ui<boolean>(`[...document.querySelectorAll('#bm-tree li li .t')].some((t) => t.textContent === 'Cálculo')`), 'subpasta na árvore');
    await ui(`document.getElementById('bookmarks-manager').close(); true`);
  });

  it('editar o favorito e escolher a pasta: sai da barra e entra na subpasta', async () => {
    await app.send({ type: 'bookmark:context', bookmarkId: await id('Moodle'), x: 100, y: 100 });
    await clickMenu(['Editar…']);
    await dialogSubmit('Moodle UFMG', '📁 Cálculo');
    const s = await app.until((x) => x.bookmarks.find((b) => b.title === 'Moodle UFMG')?.parentId === x.bookmarks.find((b) => b.title === 'Cálculo')!.id, 'movido');
    expect(s.bookmarks.length).toBe(4);
    await waitFor(async () => !(await bar()).some((t) => t.includes('Moodle')), 'saiu da barra');
  });

  it('clicar na pasta abre o menu com as subpastas; escolher abre o site', async () => {
    const fac = await id('Faculdade');
    await app.ui.mouseClick(`#bookmark-items .bm[data-bookmark-id="${fac}"]`);
    await waitFor(async () => (await menuLabels()).includes('📁 Cálculo'), 'menu da pasta');
    expect(await menuLabels(['📁 Cálculo'])).toEqual(['Moodle UFMG']);
    await clickMenu(['📁 Cálculo', 'Moodle UFMG']);
    await app.until((s) => app.activeTab(s).title === 'Moodle', 'abriu o favorito');
  });

  it('arrastar um favorito para o meio da pasta põe dentro dela; para a borda, reordena', async () => {
    const out = await id('Outlook');
    const fac = await id('Faculdade');
    await dragTo(`.bm[data-bookmark-id="${out}"]`, `.bm[data-bookmark-id="${fac}"]`, 0.5);
    await app.until((s) => s.bookmarks.find((b) => b.id === out)!.parentId === fac, 'dentro da pasta');
    // Do gerenciador de volta para a barra (antes da pasta).
    await app.send({ type: 'bookmark:move', bookmarkId: out, parentId: null, index: 0 });
    await waitFor(async () => (await bar())[0]?.includes('Outlook'), 'de volta, antes da pasta');
    await dragTo(`.bm[data-bookmark-id="${out}"]`, `.bm[data-bookmark-id="${fac}"]`, 0.95);
    await waitFor(async () => (await bar())[1]?.includes('Outlook'), 'depois da pasta');
  });

  it('pasta não entra na própria subpasta', async () => {
    await app.send({ type: 'bookmark:move', bookmarkId: await id('Faculdade'), parentId: await id('Cálculo'), index: 0 });
    expect((await app.state()).bookmarks.find((b) => b.title === 'Faculdade')!.parentId).toBeNull();
  });

  it('o que não cabe vai para o "»"', async () => {
    for (let i = 0; i < 14; i++) await app.send({ type: 'bookmark:add-folder', title: `Pasta com nome comprido ${i}`, parentId: null });
    // Espera as 14 pastas chegarem e a barra se acomodar (os itens que sobram somem no quadro seguinte).
    await app.until((x) => x.bookmarks.filter((b) => b.parentId === null).length === 16, '16 itens na barra');
    const shown = await waitFor(async () => {
      const more = await ui<boolean>(`!document.getElementById('bookmark-more').hidden`);
      const n = (await bar()).length;
      return more && n < 16 ? n : null;
    }, '» visível');
    await app.ui.mouseClick('#bookmark-more');
    await waitFor(async () => (await menuLabels()).includes('📁 Pasta com nome comprido 13'), 'menu do »');
    expect((await menuLabels()).length).toBe(16 - shown); // 2 + 14 itens na barra
  });

  it('excluir pasta (botão direito) leva o que tem dentro', async () => {
    await app.send({ type: 'bookmark:context', bookmarkId: await id('Faculdade'), x: 1, y: 1 });
    await clickMenu(['Excluir a pasta (e o que tem dentro)']);
    const s = await app.until((x) => !x.bookmarks.some((b) => b.title === 'Faculdade'), 'excluída');
    expect(s.bookmarks.some((b) => b.title === 'Moodle UFMG' || b.title === 'Cálculo')).toBe(false);
  });

  it('Ctrl+Shift+B esconde e mostra a barra (fica salvo)', async () => {
    await main.eval(`globalThis.__apolloTest.browser.runShortcut('bookmark-bar'); true`);
    await waitFor(() => ui<boolean>(`document.getElementById('bookmark-bar').hidden`), 'escondida');
    await app.quit();
    app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1' });
    main = await app.main();
    expect((await app.state()).settings.bookmarkBar).toBe(false);
    await app.send({ type: 'settings:bookmark-bar', show: true });
    await waitFor(() => ui<boolean>(`!document.getElementById('bookmark-bar').hidden`), 'de volta');
  });

  it('cada workspace tem a própria barra', async () => {
    await app.send({ type: 'workspace:create', name: 'Banco', color: '#22aa66', home: '' });
    await app.until((s) => s.workspaces.length === 2 && s.bookmarks.length === 0, 'outro workspace sem favoritos');
    await waitFor(() => ui<boolean>(`!!document.querySelector('#bookmark-bar .empty')`), 'barra vazia');
  });
});

describe('ferramentas na barra direita e histórico', () => {
  it('busca, histórico, downloads e memória ficam no rodapé da barra direita', async () => {
    expect(await ui<string[]>(`[...document.querySelectorAll('#panel-rail .tool')].map((b) => b.id)`))
      .toEqual(['palette-btn', 'history-btn', 'downloads-btn', 'memory-btn']);
    expect(await ui<number>(`document.querySelectorAll('#navbar #palette-btn, #navbar #memory-btn, #navbar #downloads-btn').length`)).toBe(0);
  });

  it('janela de histórico: lista por dia, busca, apaga um item e abre ao clicar', async () => {
    await open('Cálculo Diferencial');
    await open('Álgebra Linear');
    await app.send({ type: 'tab:new' });
    await app.ui.mouseClick('#history-btn');
    await waitFor(() => dialogOpen('history-dialog'), 'histórico aberto');
    const titles = () => ui<string[]>(`[...document.querySelectorAll('#history-list .entry .t')].map((t) => t.textContent)`);
    await waitFor(async () => (await titles()).join() === 'Álgebra Linear,Cálculo Diferencial', 'mais recente primeiro');
    expect(await ui<string>(`document.querySelector('#history-list .day').textContent`)).toBe('Hoje');
    await ui(`(() => { const q = document.getElementById('history-q'); q.value = 'calculo'; q.dispatchEvent(new Event('input')); return true; })()`);
    await waitFor(async () => (await titles()).join() === 'Cálculo Diferencial', 'filtrado');
    await app.ui.mouseClick('#history-list .entry button[title="Apagar do histórico"]');
    await waitFor(async () => (await titles()).length === 0, 'apagado');
    await ui(`(() => { const q = document.getElementById('history-q'); q.value = ''; q.dispatchEvent(new Event('input')); return true; })()`);
    await waitFor(async () => (await titles()).join() === 'Álgebra Linear', 'sobrou um');
    await app.ui.mouseClick('#history-list .entry .t');
    await app.until((s) => app.activeTab(s).title === 'Álgebra Linear', 'abriu na aba (estava na página inicial)');
    expect(await dialogOpen('history-dialog')).toBe(false);
  });
});
