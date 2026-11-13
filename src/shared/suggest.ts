// Sugestões da barra de endereço (puro, testável): histórico, favoritos e abas do
// workspace que casam com o que foi digitado, e o autocompletar na própria barra.
// Nada sai do computador: a busca no site de pesquisa só acontece no Enter.
import { fold } from './text';

export type SuggestionKind = 'history' | 'bookmark' | 'tab';

export interface Suggestion {
  kind: SuggestionKind;
  url: string;
  title: string;
  /** kind 'tab': a aba aberta para onde ir. */
  tabId?: string;
}

/** Completar na barra: o que aparece (texto digitado + resto selecionado) e para onde vai. */
export interface InlineCompletion {
  text: string;
  url: string;
}

export interface SuggestSources {
  /** Já filtrado e ordenado por frecência (Store.searchHistory). */
  history: { url: string; title: string }[];
  bookmarks: { url: string; title: string }[];
  tabs: { id: string; url: string; title: string }[];
}

export const MAX_SUGGESTIONS = 8;

/** Endereço como se lê: sem esquema e sem "www." ("https://www.ufmg.br/x" → "ufmg.br/x"). */
export function bareUrl(url: string): string {
  let u = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  try { u = decodeURI(u); } catch { /* malformada: como está */ }
  return u;
}

const WEB = /^https?:\/\//i;

function matches(words: string[], s: { url: string; title: string }): boolean {
  const hay = fold(`${s.title} ${bareUrl(s.url)}`);
  return words.every((w) => hay.includes(w));
}

/** Site cujo endereço começa com o que foi digitado (sem espaço): vai para o topo e completa a barra. */
function prefixOf(text: string, url: string): boolean {
  return !/\s/.test(text) && bareUrl(url).toLowerCase().startsWith(text.toLowerCase());
}

export function buildSuggestions(text: string, src: SuggestSources, limit = MAX_SUGGESTIONS): Suggestion[] {
  const t = text.trim();
  const words = fold(t).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const all: Suggestion[] = [
    ...src.bookmarks.filter((b) => WEB.test(b.url)).map((b) => ({ kind: 'bookmark' as const, url: b.url, title: b.title })),
    ...src.history.filter((h) => WEB.test(h.url)).map((h) => ({ kind: 'history' as const, url: h.url, title: h.title })),
    ...src.tabs.filter((x) => WEB.test(x.url)).map((x) => ({ kind: 'tab' as const, url: x.url, title: x.title, tabId: x.id })),
  ].filter((s) => s.kind === 'history' || matches(words, s)); // histórico já vem filtrado pelo banco

  // Endereços que começam com o digitado primeiro (o mais curto antes: "you" → youtube.com, não youtube.com/watch…).
  const prefixed = all.filter((s) => prefixOf(t, s.url)).sort((a, b) => bareUrl(a.url).length - bareUrl(b.url).length);
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const s of [...prefixed, ...all]) {
    const key = s.url.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Autocompletar: se a primeira sugestão começa com o digitado, completa até o fim do
 * domínio ("you" → "youtube.com"); se já passou do domínio, até o endereço inteiro.
 */
export function inlineCompletion(text: string, first: Suggestion | undefined): InlineCompletion | null {
  if (!first || !text || /\s/.test(text) || !prefixOf(text, first.url)) return null;
  const bare = bareUrl(first.url);
  let host: string;
  let origin: string;
  try {
    const u = new URL(first.url);
    host = u.host.replace(/^www\./i, '');
    origin = u.origin;
  } catch { return null; }
  if (text.length <= host.length) {
    if (text.length === host.length) return null; // já digitou o domínio inteiro
    return { text: text + host.slice(text.length), url: `${origin}/` };
  }
  if (text.length >= bare.length) return null;
  return { text: text + bare.slice(text.length), url: first.url };
}
