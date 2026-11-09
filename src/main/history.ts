// Histórico de navegação de uma aba (voltar/avançar), salvo no banco para
// sobreviver a reinícios e à hibernação.

export interface HistoryEntry {
  url: string;
  title: string;
  /** Estado da página do Chromium (rolagem, formulários), em base64. */
  pageState?: string;
}

export interface TabHistory {
  index: number;
  entries: HistoryEntry[];
}

export const MAX_HISTORY_ENTRIES = 50;

const RESTORABLE = /^(https?|apollo|file):/i;

/** Página de erro guarda a URL original: restaurar a URL, não a página de erro. */
function unwrapError(entry: HistoryEntry): HistoryEntry {
  if (!entry.url.startsWith('apollo://error')) return entry;
  try {
    const original = new URL(entry.url).searchParams.get('url');
    return { url: original ?? '', title: entry.title };
  } catch {
    return { url: '', title: entry.title };
  }
}

/**
 * Deixa o histórico pronto para restaurar: troca páginas de erro pela URL original,
 * descarta o que não dá para restaurar e limita o tamanho em volta da entrada atual.
 */
export function sanitizeHistory(history: TabHistory | null | undefined): TabHistory | null {
  if (!history || !Array.isArray(history.entries) || history.entries.length === 0) return null;
  let index = Math.min(Math.max(0, Math.trunc(history.index) || 0), history.entries.length - 1);

  const entries: HistoryEntry[] = [];
  history.entries.forEach((raw, i) => {
    const e = unwrapError({ url: String(raw?.url ?? ''), title: String(raw?.title ?? ''), pageState: raw?.pageState });
    if (!RESTORABLE.test(e.url)) {
      if (i < index) index--;
      return;
    }
    entries.push(e.pageState ? e : { url: e.url, title: e.title });
  });
  if (entries.length === 0) return null;
  index = Math.min(Math.max(0, index), entries.length - 1);

  // Mantém no máximo MAX entradas, priorizando o passado da entrada atual.
  const start = Math.max(0, Math.min(index - (MAX_HISTORY_ENTRIES - 1), entries.length - MAX_HISTORY_ENTRIES));
  const trimmed = entries.slice(start, start + MAX_HISTORY_ENTRIES);
  return { index: index - start, entries: trimmed };
}

/** Navegar para `url` a partir do histórico: descarta o "avançar" e vira a entrada atual. */
export function withNavigation(history: TabHistory | null, url: string): TabHistory {
  if (!history) return { index: 0, entries: [{ url, title: '' }] };
  const entries = [...history.entries.slice(0, history.index + 1), { url, title: '' }];
  return sanitizeHistory({ index: entries.length - 1, entries })!;
}

export function parseHistory(json: string | null | undefined): TabHistory | null {
  if (!json) return null;
  try {
    return sanitizeHistory(JSON.parse(json) as TabHistory);
  } catch {
    return null;
  }
}
