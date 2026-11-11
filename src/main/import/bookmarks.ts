// Importar favoritos de outros navegadores instalados neste computador: Opera, Chrome,
// Edge, Brave, Chromium (arquivo JSON "Bookmarks" de cada perfil) e Firefox
// (places.sqlite, lido de uma cópia: o Firefox aberto trava o arquivo). Só leitura.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type BrowserId = 'opera' | 'chrome' | 'edge' | 'brave' | 'chromium' | 'firefox';
export const BROWSER_NAMES: Record<BrowserId, string> = {
  opera: 'Opera', chrome: 'Chrome', edge: 'Edge', brave: 'Brave', chromium: 'Chromium', firefox: 'Firefox',
};

export interface ImportSource {
  /** Estável entre varreduras (a interface só manda o id; o caminho fica no processo principal). */
  id: string;
  browser: BrowserId;
  /** "Chrome — Pessoal" (nome do perfil, se houver mais de um). */
  label: string;
  file: string;
  kind: 'chromium' | 'firefox';
}

/** Favorito ou pasta, antes de entrar no Apollo. */
export interface ImportNode {
  title: string;
  url?: string;
  children?: ImportNode[];
}

interface Env { home: string; platform: NodeJS.Platform; appData?: string; localAppData?: string }

function chromiumBases(e: Env): [BrowserId, string][] {
  if (e.platform === 'win32') {
    const L = e.localAppData ?? '', R = e.appData ?? '';
    return [['chrome', path.join(L, 'Google/Chrome/User Data')], ['edge', path.join(L, 'Microsoft/Edge/User Data')],
      ['brave', path.join(L, 'BraveSoftware/Brave-Browser/User Data')], ['chromium', path.join(L, 'Chromium/User Data')],
      ['opera', path.join(R, 'Opera Software/Opera Stable')]];
  }
  if (e.platform === 'darwin') {
    const S = path.join(e.home, 'Library/Application Support');
    return [['chrome', path.join(S, 'Google/Chrome')], ['edge', path.join(S, 'Microsoft Edge')],
      ['brave', path.join(S, 'BraveSoftware/Brave-Browser')], ['chromium', path.join(S, 'Chromium')],
      ['opera', path.join(S, 'com.operasoftware.Opera')]];
  }
  const C = path.join(e.home, '.config');
  const flat = (id: string) => path.join(e.home, '.var/app', id, 'config');
  return [['chrome', path.join(C, 'google-chrome')], ['edge', path.join(C, 'microsoft-edge')],
    ['brave', path.join(C, 'BraveSoftware/Brave-Browser')], ['chromium', path.join(C, 'chromium')], ['opera', path.join(C, 'opera')],
    // Flatpak
    ['chrome', path.join(flat('com.google.Chrome'), 'google-chrome')], ['edge', path.join(flat('com.microsoft.Edge'), 'microsoft-edge')],
    ['brave', path.join(flat('com.brave.Browser'), 'BraveSoftware/Brave-Browser')], ['chromium', path.join(flat('org.chromium.Chromium'), 'chromium')]];
}

function firefoxBases(e: Env): string[] {
  if (e.platform === 'win32') return [path.join(e.appData ?? '', 'Mozilla/Firefox')];
  if (e.platform === 'darwin') return [path.join(e.home, 'Library/Application Support/Firefox')];
  return [path.join(e.home, '.mozilla/firefox'), path.join(e.home, '.var/app/org.mozilla.firefox/.mozilla/firefox'),
    path.join(e.home, 'snap/firefox/common/.mozilla/firefox')];
}

const readJson = (p: string): unknown => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

/** Perfis com favoritos de cada navegador instalado. */
export function detectSources(e: Env = { home: os.homedir(), platform: process.platform, appData: process.env.APPDATA, localAppData: process.env.LOCALAPPDATA }): ImportSource[] {
  const out: ImportSource[] = [];
  const seen = new Set<string>();
  const add = (s: Omit<ImportSource, 'id'>) => {
    const real = (() => { try { return fs.realpathSync(s.file); } catch { return s.file; } })();
    if (seen.has(real)) return;
    seen.add(real);
    out.push({ ...s, id: `${s.browser}:${out.length}` });
  };
  for (const [browser, base] of chromiumBases(e)) {
    if (!fs.existsSync(base)) continue;
    const names = ((readJson(path.join(base, 'Local State')) as { profile?: { info_cache?: Record<string, { name?: string }> } } | null)
      ?.profile?.info_cache) ?? {};
    const dirs = ['', ...fs.readdirSync(base).filter((d) => d === 'Default' || /^Profile \d+$/.test(d))];
    const found = dirs.filter((d) => fs.existsSync(path.join(base, d, 'Bookmarks')));
    for (const d of found) {
      const profile = names[d]?.name;
      add({ browser, kind: 'chromium', file: path.join(base, d, 'Bookmarks'),
        label: found.length > 1 && profile ? `${BROWSER_NAMES[browser]} — ${profile}` : BROWSER_NAMES[browser] });
    }
  }
  for (const base of firefoxBases(e)) {
    const ini = (() => { try { return fs.readFileSync(path.join(base, 'profiles.ini'), 'utf8'); } catch { return null; } })();
    if (!ini) continue;
    const profiles = ini.split(/^\[/m).filter((b) => /^Profile/.test(b)).map((b) => ({
      name: /^Name=(.*)$/m.exec(b)?.[1]?.trim() ?? '', rel: /^IsRelative=1/m.test(b), p: /^Path=(.*)$/m.exec(b)?.[1]?.trim() ?? '' }));
    const found = profiles.map((p) => ({ ...p, file: path.join(p.rel ? path.join(base, p.p) : p.p, 'places.sqlite') }))
      .filter((p) => p.p && fs.existsSync(p.file));
    for (const p of found) {
      add({ browser: 'firefox', kind: 'firefox', file: p.file, label: found.length > 1 && p.name ? `Firefox — ${p.name}` : 'Firefox' });
    }
  }
  return out;
}

// ------------------------------------------------------------ Chromium (JSON)

interface ChromiumNode { type?: string; name?: string; url?: string; children?: ChromiumNode[] }

const okUrl = (u: string | undefined): u is string => typeof u === 'string' && /^(https?|ftp|file):/i.test(u) && u.length <= 8192;

function fromChromium(n: ChromiumNode, depth = 0): ImportNode | null {
  if (n.type === 'url') return okUrl(n.url) ? { title: (n.name || n.url).slice(0, 300), url: n.url } : null;
  if (n.type !== 'folder' || depth > 32) return null;
  const children = (n.children ?? []).map((c) => fromChromium(c, depth + 1)).filter((c): c is ImportNode => c !== null);
  return { title: (n.name || 'Pasta').slice(0, 300), children };
}

/** Seções do arquivo (com nomes em português). Lixeira e Pinboards do Opera ficam de fora. */
export function parseChromium(json: unknown): ImportNode[] {
  const roots = (json as { roots?: Record<string, ChromiumNode & Record<string, ChromiumNode>> })?.roots;
  if (!roots || typeof roots !== 'object') throw new Error('arquivo de favoritos inválido');
  const sections: [string, ChromiumNode | undefined][] = [
    ['Barra de favoritos', roots.bookmark_bar], ['Outros favoritos', roots.other], ['Favoritos do celular', roots.synced],
    ['Discagem rápida', roots.custom_root?.speedDial], ['Não classificados', roots.custom_root?.unsorted],
    ['Meus favoritos', roots.custom_root?.userRoot],
  ];
  return sections.flatMap(([title, n]) => {
    const node = n && fromChromium(n);
    return node && node.children?.length ? [{ ...node, title }] : [];
  });
}

// ------------------------------------------------------------ Firefox (places.sqlite)

/** Lê uma cópia (o Firefox aberto trava o arquivo e o journal WAL). */
export function parseFirefox(file: string): ImportNode[] {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-import-'));
  try {
    const copy = path.join(tmp, 'places.sqlite');
    fs.copyFileSync(file, copy);
    for (const ext of ['-wal', '-shm']) if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, copy + ext);
    const db = new DatabaseSync(copy);
    try {
      const rows = db.prepare(`SELECT b.id, b.type, b.parent, b.position, b.title, b.guid, p.url
        FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position`).all() as
        { id: number; type: number; parent: number; position: number; title: string | null; guid: string; url: string | null }[];
      const kids = new Map<number, typeof rows>();
      for (const r of rows) kids.set(r.parent, [...(kids.get(r.parent) ?? []), r]);
      const build = (id: number, depth: number): ImportNode[] => (depth > 32 ? [] : (kids.get(id) ?? []).flatMap((r): ImportNode[] => {
        if (r.type === 1) return okUrl(r.url ?? undefined) ? [{ title: (r.title || r.url!).slice(0, 300), url: r.url! }] : [];
        if (r.type === 2) return [{ title: (r.title || 'Pasta').slice(0, 300), children: build(r.id, depth + 1) }];
        return []; // separadores
      }));
      const byGuid = new Map(rows.map((r) => [r.guid, r]));
      const sections: [string, string][] = [['Barra de favoritos', 'toolbar_____'], ['Menu de favoritos', 'menu________'],
        ['Outros favoritos', 'unfiled_____'], ['Favoritos do celular', 'mobile______']];
      return sections.flatMap(([title, guid]) => {
        const r = byGuid.get(guid);
        const children = r ? build(r.id, 0) : [];
        return children.length ? [{ title, children }] : [];
      });
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function readSource(s: ImportSource): ImportNode[] {
  return s.kind === 'firefox' ? parseFirefox(s.file) : parseChromium(readJson(s.file));
}

/** Quantos favoritos (não pastas) há na árvore. */
export const countBookmarks = (nodes: ImportNode[]): number =>
  nodes.reduce((n, x) => n + (x.url ? 1 : countBookmarks(x.children ?? [])), 0);
