// Importar favoritos de outros navegadores (pedido do usuário): pasta pessoal falsa com
// Chrome (JSON) e Firefox (places.sqlite).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, tempProfile, waitFor } from './harness';

let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let home: string;

beforeAll(async () => {
  profile = tempProfile();
  home = path.join(profile.dir, 'home-falsa');
  const chrome = path.join(home, '.config/google-chrome/Default');
  fs.mkdirSync(chrome, { recursive: true });
  fs.writeFileSync(path.join(chrome, 'Bookmarks'), JSON.stringify({ roots: {
    bookmark_bar: { type: 'folder', name: 'Bar', children: [
      { type: 'url', name: 'Moodle', url: 'https://moodle.ufmg.br/' },
      { type: 'folder', name: 'Trabalho', children: [{ type: 'url', name: 'Jira', url: 'https://jira.example/' }] }] },
    other: { type: 'folder', name: 'Other', children: [{ type: 'url', name: 'Wiki', url: 'https://pt.wikipedia.org/' }] },
  } }));
  const ff = path.join(home, '.mozilla/firefox');
  fs.mkdirSync(path.join(ff, 'x.default'), { recursive: true });
  fs.writeFileSync(path.join(ff, 'profiles.ini'), '[Profile0]\nName=default\nIsRelative=1\nPath=x.default\n');
  const db = new DatabaseSync(path.join(ff, 'x.default/places.sqlite'));
  db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT);
    INSERT INTO moz_places VALUES (1, 'https://github.com/');
    INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 'root________'), (2, 2, NULL, 1, 0, 'toolbar', 'toolbar_____'), (3, 1, 1, 2, 0, 'GitHub', 'g1');`);
  db.close();
  app = await Apollo.launch(profile.dir, { APOLLO_TEST_IMPORT_HOME: home });
});
afterAll(async () => {
  await app?.quit();
  profile?.cleanup();
});

const ui = <T>(js: string) => app.ui.eval<T>(js);

describe('importar favoritos', () => {
  it('lista os navegadores encontrados com a quantidade', async () => {
    await app.ui.mouseClick('#settings-btn');
    await app.ui.mouseClick('#settings-nav button[data-section="bookmarks"]');
    await app.ui.mouseClick('#settings-import-bookmarks');
    await waitFor(() => ui<boolean>(`document.getElementById('import-dialog').open`), 'diálogo');
    const rows = await waitFor(async () => {
      const r = await ui<string[][]>(`[...document.querySelectorAll('#import-list li')].filter((li) => li.querySelector('button')).map((li) => [li.querySelector('.t').textContent, li.querySelector('.n').textContent])`);
      return r.length ? r : null;
    }, 'lista');
    expect(rows).toEqual([['Chrome', '3 favoritos'], ['Firefox', '1 favorito']]);
  });

  it('importa do Chrome mantendo as pastas, numa pasta nova da barra', async () => {
    const id = await ui<string>(`[...document.querySelectorAll('#import-list li button')][0].dataset.sourceId`);
    await app.ui.mouseClick(`#import-list button[data-source-id="${id}"]`);
    const s = await app.until((x) => x.importResult !== null && x.bookmarks.length > 0, 'importado');
    expect(s.importResult).toMatchObject({ label: 'Chrome', count: 3 });
    const root = s.bookmarks.find((b) => b.parentId === null && b.title.startsWith('Importados do Chrome'))!;
    const sections = s.bookmarks.filter((b) => b.parentId === root.id).map((b) => b.title);
    expect(sections).toEqual(['Barra de favoritos', 'Outros favoritos']);
    const bar = s.bookmarks.find((b) => b.parentId === root.id && b.title === 'Barra de favoritos')!;
    expect(s.bookmarks.filter((b) => b.parentId === bar.id).map((b) => [b.title, b.folder])).toEqual([['Moodle', false], ['Trabalho', true]]);
    expect(await ui<string>(`document.getElementById('import-result').textContent`)).toContain('3 favoritos importados do Chrome');
  });

  it('importa do Firefox', async () => {
    const id = await ui<string>(`[...document.querySelectorAll('#import-list li button')][1].dataset.sourceId`);
    await app.ui.mouseClick(`#import-list button[data-source-id="${id}"]`);
    const s = await app.until((x) => x.bookmarks.some((b) => b.title === 'GitHub'), 'firefox');
    expect(s.importResult).toMatchObject({ label: 'Firefox', count: 1 });
  });
});
