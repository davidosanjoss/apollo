import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countBookmarks, detectSources, parseChromium, parseFirefox } from '../../src/main/import/bookmarks';

let home: string;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-imp-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const url = (name: string, u: string) => ({ type: 'url', name, url: u });
const folder = (name: string, children: object[]) => ({ type: 'folder', name, children });
function chromiumFile(dir: string, roots: object) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Bookmarks'), JSON.stringify({ version: 1, roots }));
}

/** places.sqlite mínimo (mesmo esquema do Firefox para as colunas usadas). */
function firefoxPlaces(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT);
    INSERT INTO moz_places VALUES (1, 'https://moodle.ufmg.br/'), (2, 'place:sort=8'), (3, 'https://github.com/');
    INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 'root________');
    INSERT INTO moz_bookmarks VALUES (2, 2, NULL, 1, 0, 'toolbar', 'toolbar_____');
    INSERT INTO moz_bookmarks VALUES (3, 2, NULL, 1, 1, 'menu', 'menu________');
    INSERT INTO moz_bookmarks VALUES (4, 2, NULL, 2, 0, 'Faculdade', 'f1');
    INSERT INTO moz_bookmarks VALUES (5, 1, 1, 4, 0, 'Moodle', 'b1');
    INSERT INTO moz_bookmarks VALUES (6, 3, NULL, 2, 1, NULL, 'sep');
    INSERT INTO moz_bookmarks VALUES (7, 1, 2, 3, 0, 'Mais visitados', 'smart');
    INSERT INTO moz_bookmarks VALUES (8, 1, 3, 2, 2, 'GitHub', 'b2');`);
  db.close();
}

describe('importar favoritos', () => {
  it('Chromium/Opera: seções com nomes em português; sem lixeira, Pinboards nem links estranhos', () => {
    const tree = parseChromium({ roots: {
      bookmark_bar: folder('Bookmarks bar', [url('Moodle', 'https://moodle.ufmg.br/'), folder('Trabalho', [url('Jira', 'https://jira.x/')]),
        url('Script', 'javascript:alert(1)')]),
      other: folder('Other', []),
      custom_root: { speedDial: folder('SD', [url('YouTube', 'https://youtube.com/')]), trash: folder('Lixo', [url('Velho', 'https://old.com/')]),
        pinboard: folder('Pins', [url('Pin', 'https://pin.com/')]) },
    } });
    expect(tree.map((t) => t.title)).toEqual(['Barra de favoritos', 'Discagem rápida']);
    expect(tree[0].children!.map((c) => c.title)).toEqual(['Moodle', 'Trabalho']);
    expect(countBookmarks(tree)).toBe(3);
    expect(() => parseChromium({ nada: 1 })).toThrow();
  });

  it('Firefox: barra e menu com pastas; separadores e "pastas inteligentes" ficam de fora', () => {
    const file = path.join(home, 'places.sqlite');
    firefoxPlaces(file);
    const tree = parseFirefox(file);
    expect(tree.map((t) => t.title)).toEqual(['Barra de favoritos']);
    expect(tree[0].children).toEqual([{ title: 'Faculdade', children: [{ title: 'Moodle', url: 'https://moodle.ufmg.br/' }] },
      { title: 'GitHub', url: 'https://github.com/' }]);
  });

  it('acha os perfis instalados (Linux), com o nome do perfil quando há mais de um', () => {
    const chrome = path.join(home, '.config/google-chrome');
    chromiumFile(path.join(chrome, 'Default'), { bookmark_bar: folder('b', [url('a', 'https://a.com/')]) });
    chromiumFile(path.join(chrome, 'Profile 1'), { bookmark_bar: folder('b', [url('b', 'https://b.com/')]) });
    fs.writeFileSync(path.join(chrome, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Pessoal' }, 'Profile 1': { name: 'Trabalho' } } } }));
    chromiumFile(path.join(home, '.config/opera/Default'), { bookmark_bar: folder('b', []) });
    const ff = path.join(home, '.mozilla/firefox');
    firefoxPlaces(path.join(ff, 'abc.default-release/places.sqlite'));
    fs.writeFileSync(path.join(ff, 'profiles.ini'), '[Profile0]\nName=default-release\nIsRelative=1\nPath=abc.default-release\n');
    const s = detectSources({ home, platform: 'linux' });
    expect(s.map((x) => [x.browser, x.label])).toEqual([
      ['chrome', 'Chrome — Pessoal'], ['chrome', 'Chrome — Trabalho'], ['opera', 'Opera'], ['firefox', 'Firefox']]);
    expect(new Set(s.map((x) => x.id)).size).toBe(4);
  });
});
