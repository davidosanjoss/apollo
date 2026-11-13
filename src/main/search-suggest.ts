// Sugestões de pesquisa vindas do Google (como no Opera/Chrome), para a barra de endereço.
// Sai só o texto digitado: sem cookies, sem login, sem o endereço da aba. Desligável em
// Configurações → Histórico e nunca nos workspaces temporários.

export const GOOGLE_SUGGEST_API = 'https://suggestqueries.google.com/complete/search?client=firefox&hl=pt-BR&ie=utf-8&oe=utf-8&q=';
export const MAX_SEARCH_SUGGESTIONS = 4;

/** Resposta no formato do OpenSearch: ["texto", ["sugestão 1", "sugestão 2", …], …]. */
export function parseSuggestResponse(body: unknown, query: string): string[] {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return [];
  const q = query.trim().toLowerCase();
  const out: string[] = [];
  for (const s of body[1] as unknown[]) {
    if (typeof s !== 'string') continue;
    const t = s.trim().slice(0, 200);
    if (!t || t.toLowerCase() === q || out.includes(t)) continue;
    out.push(t);
    if (out.length >= MAX_SEARCH_SUGGESTIONS) break;
  }
  return out;
}

/** Texto que não faz sentido mandar para o buscador (endereço, caminho, esquema). */
export function worthSuggesting(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 200 && !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('/');
}

type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Busca com cache curto e só a última pergunta valendo: ao digitar a próxima letra, a
 * anterior é cancelada. Falha (offline, bloqueio) = sem sugestões, sem erro.
 */
export class SearchSuggester {
  private controller: AbortController | null = null;
  private readonly cache = new Map<string, string[]>();

  constructor(private readonly api: string | null, private readonly fetchImpl: Fetch, private readonly timeoutMs = 1500) {}

  get enabled(): boolean {
    return Boolean(this.api);
  }

  async suggest(query: string): Promise<string[] | null> {
    const q = query.trim();
    if (!this.api || !worthSuggesting(q)) return [];
    const key = q.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.api + encodeURIComponent(q), { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      if (!res.ok) return [];
      const list = parseSuggestResponse(await res.json(), q);
      this.cache.set(key, list);
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
      return list;
    } catch {
      return controller.signal.aborted && this.controller !== controller ? null : []; // null = substituída por outra
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = null;
    }
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }
}
