// Quais logins servem para a página: regras de correspondência do Bitwarden.
import { getDomain } from 'tldts';
import type { LoginUri, VaultLogin } from './vault';

export const MATCH = { Domain: 0, Host: 1, StartsWith: 2, Exact: 3, RegularExpression: 4, Never: 5 } as const;

function parse(url: string): URL | null {
  try {
    // "outlook.office.com" salvo sem esquema: o Bitwarden assume https.
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
}

const baseDomain = (host: string) => getDomain(host, { allowPrivateDomains: true }) ?? host;

export function uriMatches(saved: LoginUri, pageUrl: string, defaultMatch: number = MATCH.Domain): boolean {
  const page = parse(pageUrl);
  if (!page || !/^https?:$/.test(page.protocol)) return false;
  const rule = saved.match ?? defaultMatch;
  if (rule === MATCH.Never) return false;
  if (rule === MATCH.RegularExpression) {
    if (saved.uri.length > 500) return false;
    try { return new RegExp(saved.uri, 'i').test(pageUrl); } catch { return false; }
  }
  if (rule === MATCH.Exact) return saved.uri === pageUrl;
  if (rule === MATCH.StartsWith) return pageUrl.startsWith(saved.uri);

  const uri = parse(saved.uri);
  if (!uri) return false;
  // Proteção extra: login salvo em https nunca é oferecido numa página http.
  if (uri.protocol === 'https:' && page.protocol === 'http:') return false;
  if (rule === MATCH.Host) return uri.host === page.host;
  return baseDomain(uri.hostname) === baseDomain(page.hostname); // Domain (padrão)
}

/** Logins que servem para a página, em ordem alfabética. */
export function loginsFor(logins: VaultLogin[], pageUrl: string, defaultMatch: number = MATCH.Domain): VaultLogin[] {
  return logins
    .filter((l) => l.uris.some((u) => uriMatches(u, pageUrl, defaultMatch)))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || (a.username ?? '').localeCompare(b.username ?? ''));
}
