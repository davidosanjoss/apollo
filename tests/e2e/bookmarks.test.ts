// Favoritos: por workspace, na estrela/Ctrl+D, na página inicial e no Ctrl+K.
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
const dialogOpen = () => ui<boolean>(`document.getElementById('bookmark-dialog').open`);
const tiles = () => ui<string[]>(`[...document.querySelectorAll('#home-bookmarks .name')].map((n) => n.textContent)`);
async function open(title: string) {
  await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=${title}` });
  await app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, title);
}

describe('favoritos', () => {
  it('estrela marca a página e abre o diálogo para editar o nome', async () => {
    await open('Moodle');
    expect(await ui<string>(`document.getElementById('bookmark-btn').textContent`)).toBe('☆');
    await app.ui.mouseClick('#bookmark-btn');
    await waitFor(dialogOpen, 'diálogo do favorito');
    const s = await app.until((x) => x.activeBookmarkId !== null, 'favoritado');
    expect(s.bookmarks.map((b) => b.title)).toEqual(['Moodle']);
    expect(await ui<string>(`document.getElementById('bookmark-btn').textContent`)).toBe('★');
    await ui(`document.getElementById('bookmark-title').value = 'Moodle UFMG'; document.getElementById('bookmark-form').requestSubmit(); true`);
    await app.until((x) => x.bookmarks[0]?.title === 'Moodle UFMG', 'renomeado');
    expect(await dialogOpen()).toBe(false);
  });

  // O Ctrl+D (→ 'bookmark') é coberto em tests/unit/shortcuts.test.ts: tecla enviada pelo
  // CDP não passa pelo before-input-event do Electron. Aqui, o mesmo fluxo pelo Ctrl+K.
  it('Ctrl+K "Adicionar esta página": marca; de novo pela estrela, só edita (não duplica)', async () => {
    await open('Outlook');
    await ui(`(() => { document.getElementById('palette-btn').click(); const i = document.getElementById('palette-input');
      i.value = 'adicionar esta pagina'; i.dispatchEvent(new Event('input')); return true; })()`);
    await waitFor(async () => ui<boolean>(`document.querySelector('#palette-list .item.selected .title')?.textContent === 'Adicionar esta página aos favoritos'`), 'ação na paleta');
    await app.ui.pressEnter('#palette-input');
    await app.until((x) => x.bookmarks.length === 2 && x.activeBookmarkId !== null, 'segundo favorito');
    await waitFor(dialogOpen, 'diálogo');
    await app.ui.mouseClick('#bookmark-cancel');
    await waitFor(async () => !(await dialogOpen()), 'fechou');
    await app.ui.mouseClick('#bookmark-btn');
    await waitFor(dialogOpen, 'diálogo de novo');
    expect(await ui<string>(`document.getElementById('bookmark-title').value`)).toBe('Outlook');
    expect((await app.state()).bookmarks).toHaveLength(2);
    await app.ui.mouseClick('#bookmark-cancel');
  });

  it('aparecem na página inicial; clicar abre na própria aba (que ganha processo)', async () => {
    await app.send({ type: 'tab:new' });
    await app.until((s) => app.activeTab(s).url.startsWith('apollo://home') && !app.activeTab(s).live, 'página inicial');
    expect(await tiles()).toEqual(['Moodle UFMG', 'Outlook']);
    const before = (await app.state()).tabs.length;
    await app.ui.mouseClick('#home-bookmarks li:first-child a');
    const s = await app.until((x) => app.activeTab(x).title === 'Moodle' && app.activeTab(x).live, 'abriu o favorito');
    expect(s.tabs).toHaveLength(before);
    expect(s.activeBookmarkId).toBe(s.bookmarks[0].id);
  });

  it('arrastar reordena (inclusive para depois do último)', async () => {
    await app.send({ type: 'tab:new' });
    await app.until((s) => !app.activeTab(s).live, 'página inicial');
    // Arrastar do HTML5 (o mouse do CDP não inicia drag-and-drop): primeiro bloco solto
    // na metade direita do segundo = vai para o fim.
    await ui(`(() => {
      const [a, b] = document.querySelectorAll('#home-bookmarks li');
      const r = b.getBoundingClientRect();
      const dt = new DataTransfer();
      const ev = (type, el) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: r.left + r.width * 0.8, clientY: r.top + r.height / 2 }));
      ev('dragstart', a); ev('dragover', b); ev('drop', b); ev('dragend', a);
      return true; })()`);
    await app.until((s) => s.bookmarks.map((b) => b.title).join() === 'Outlook,Moodle UFMG', 'reordenado');
    await waitFor(async () => (await tiles()).join() === 'Outlook,Moodle UFMG', 'blocos reordenados');
  });

  it('Ctrl+K encontra o favorito', async () => {
    await app.send({ type: 'palette:toggle', open: true });
    await ui(`(() => { document.getElementById('palette-btn').click(); const i = document.getElementById('palette-input');
      i.value = 'outl'; i.dispatchEvent(new Event('input')); return true; })()`);
    const first = await waitFor(async () => ui<string | null>(`document.querySelector('#palette-list .item.selected .title')?.textContent ?? null`), 'paleta');
    expect(first).toBe('Outlook');
    await ui(`document.getElementById('palette').close(); true`);
  });

  it('são do workspace: outro workspace não vê; sobrevivem ao reinício', async () => {
    await app.send({ type: 'workspace:create', name: 'Banco', color: '#22aa66', home: '' });
    await app.until((s) => s.workspaces.length === 2 && s.bookmarks.length === 0, 'workspace novo sem favoritos');
    await app.quit();
    app = await Apollo.launch(profile.dir);
    const s = await app.state();
    const first = s.workspaces.find((w) => w.name !== 'Banco')!;
    await app.send({ type: 'workspace:switch', workspaceId: first.id });
    await app.until((x) => x.bookmarks.map((b) => b.title).join() === 'Outlook,Moodle UFMG', 'favoritos após reiniciar');
  });

  it('remover pelo diálogo (botão direito no bloco)', async () => {
    await app.send({ type: 'tab:new' });
    await app.until((s) => !app.activeTab(s).live, 'página inicial');
    await waitFor(async () => (await tiles()).length === 2, 'blocos');
    await ui(`document.querySelector('#home-bookmarks li a').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); true`);
    await waitFor(dialogOpen, 'diálogo');
    await app.ui.mouseClick('#bookmark-remove');
    await app.until((s) => s.bookmarks.map((b) => b.title).join() === 'Moodle UFMG', 'removido');
  });
});
