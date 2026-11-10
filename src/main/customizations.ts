// Personalizações por site (CSS/JS do usuário): a quais páginas se aplicam.
export interface Customization {
  id: string;
  name: string;
  /** Sites separados por vírgula/espaço: "youtube.com, moodle.ufmg.br" ou "*" para todos. */
  sites: string;
  css: string;
  js: string;
  enabled: boolean;
}

export const MAX_CODE = 100_000;

/** "youtube.com" vale para youtube.com e subdomínios (www, music…); "*" vale para todos. */
export function siteMatches(sites: string, url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return sites.split(/[\s,]+/).map((s) => s.trim().toLowerCase().replace(/^\*\./, '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean)
    .some((s) => s === '*' || host === s || host.endsWith(`.${s}`));
}

export function customizationsFor(list: Customization[], url: string): Customization[] {
  return list.filter((c) => c.enabled && siteMatches(c.sites, url));
}
