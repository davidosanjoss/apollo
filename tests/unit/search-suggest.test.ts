import { describe, expect, it } from 'vitest';
import { parseSuggestResponse, SearchSuggester, worthSuggesting } from '../../src/main/search-suggest';

const ok = (body: unknown) => ({ ok: true, json: async () => body });

describe('sugestões de pesquisa do buscador', () => {
  it('lê o formato OpenSearch; tira o próprio texto, repetidas e lixo; no máximo 4', () => {
    expect(parseSuggestResponse(['bolo', ['bolo', 'bolo de cenoura', 'Bolo de cenoura', 'bolo de cenoura', 3, '', 'bolo de fubá', 'bolo de milho', 'bolo de chocolate', 'outro']], 'bolo'))
      .toEqual(['bolo de cenoura', 'Bolo de cenoura', 'bolo de fubá', 'bolo de milho']);
    expect(parseSuggestResponse({ erro: 1 }, 'x')).toEqual([]);
    expect(parseSuggestResponse(['x'], 'x')).toEqual([]);
  });

  it('não manda endereço, caminho ou esquema para o buscador', () => {
    expect(worthSuggesting('receita de bolo')).toBe(true);
    expect(worthSuggesting('https://banco.com/conta')).toBe(false);
    expect(worthSuggesting('file:///home')).toBe(false);
    expect(worthSuggesting('/etc/senhas')).toBe(false);
    expect(worthSuggesting('   ')).toBe(false);
  });

  it('sem endereço do buscador: desligado, não busca nada', async () => {
    let calls = 0;
    const s = new SearchSuggester(null, async () => { calls++; return ok([]); });
    expect(s.enabled).toBe(false);
    expect(await s.suggest('bolo')).toEqual([]);
    expect(calls).toBe(0);
  });

  it('manda só o texto, sem cookies; guarda em cache', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const s = new SearchSuggester('https://busca.test/?q=', async (url, init) => { seen.push({ url, init }); return ok(['bolo de', ['bolo de fubá']]); });
    expect(await s.suggest('bolo de')).toEqual(['bolo de fubá']);
    expect(await s.suggest('Bolo de ')).toEqual(['bolo de fubá']);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://busca.test/?q=bolo%20de');
    expect(seen[0].init.credentials).toBe('omit');
  });

  it('a pergunta anterior é cancelada quando chega a próxima; falha vira lista vazia', async () => {
    const s = new SearchSuggester('https://busca.test/?q=', (url, init) => new Promise((resolve, reject) => {
      if (url.endsWith('=b')) init.signal!.addEventListener('abort', () => reject(new Error('abort')));
      else if (url.endsWith('=erro')) reject(new Error('offline'));
      else resolve(ok(['bo', ['bolo']]));
    }));
    const first = s.suggest('b');
    expect(await s.suggest('bo')).toEqual(['bolo']);
    expect(await first).toBeNull(); // substituída: quem chamou ignora
    expect(await s.suggest('erro')).toEqual([]);
  });
});
