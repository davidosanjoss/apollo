import { describe, expect, it } from 'vitest';
import { bareUrl, buildSuggestions, inlineCompletion, type SuggestSources } from '../../src/shared/suggest';

const src = (p: Partial<SuggestSources>): SuggestSources => ({ history: [], bookmarks: [], tabs: [], ...p });

describe('sugestões da barra de endereço', () => {
  it('nada digitado: nada sugerido', () => {
    expect(buildSuggestions('  ', src({ history: [{ url: 'https://a.com/', title: 'A' }] }))).toEqual([]);
  });

  it('favoritos e abas casam por palavra (sem acento); histórico já vem filtrado', () => {
    const s = buildSuggestions('calculo', src({
      bookmarks: [{ url: 'https://moodle.ufmg.br/c', title: 'Cálculo I' }, { url: 'https://x.com/', title: 'Outro' }],
      history: [{ url: 'https://wiki.org/Calculo', title: 'Cálculo – Wiki' }],
      tabs: [{ id: 't1', url: 'https://notas.app/calculo', title: 'Notas' }],
    }));
    expect(s.map((x) => [x.kind, x.url])).toEqual([
      ['bookmark', 'https://moodle.ufmg.br/c'],
      ['history', 'https://wiki.org/Calculo'],
      ['tab', 'https://notas.app/calculo'],
    ]);
    expect(s[2].tabId).toBe('t1');
  });

  it('endereço que começa com o digitado vai primeiro, o mais curto antes; sem repetir', () => {
    const s = buildSuggestions('you', src({
      history: [
        { url: 'https://www.youtube.com/watch?v=1', title: 'Vídeo' },
        { url: 'https://www.youtube.com/', title: 'YouTube' },
        { url: 'https://blog.com/you', title: 'you' },
      ],
      bookmarks: [{ url: 'https://www.youtube.com', title: 'YouTube' }],
    }));
    expect(s.map((x) => x.url)).toEqual(['https://www.youtube.com', 'https://www.youtube.com/watch?v=1', 'https://blog.com/you']);
  });

  it('só páginas da web; no máximo o limite', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ url: `https://s${i}.com/`, title: 'x' }));
    expect(buildSuggestions('x', src({ history }), 5)).toHaveLength(5);
    expect(buildSuggestions('x', src({ tabs: [{ id: 'h', url: 'apollo://home', title: 'x' }] }))).toEqual([]);
  });

  it('completa até o fim do domínio, depois até o endereço', () => {
    const yt = { kind: 'history' as const, url: 'https://www.youtube.com/feed/subscriptions', title: '' };
    expect(inlineCompletion('you', yt)).toEqual({ text: 'youtube.com', url: 'https://www.youtube.com/' });
    expect(inlineCompletion('YouT', yt)).toEqual({ text: 'YouTube.com', url: 'https://www.youtube.com/' });
    expect(inlineCompletion('youtube.com/fe', yt)).toEqual({ text: 'youtube.com/feed/subscriptions', url: yt.url });
    expect(inlineCompletion('youtube.com', yt)).toBeNull(); // domínio inteiro: não empurra para a página
    expect(inlineCompletion('tube', yt)).toBeNull(); // no meio: não completa
    expect(inlineCompletion('you tube', yt)).toBeNull();
    expect(inlineCompletion('you', undefined)).toBeNull();
  });

  it('endereço legível', () => {
    expect(bareUrl('https://www.ufmg.br/a%20b')).toBe('ufmg.br/a b');
  });
});

describe('sugestões de pesquisa (buscador) junto com as locais', () => {
  it('site que completa no topo, depois as pesquisas, depois o resto local', () => {
    const s = buildSuggestions('you', src({
      history: [{ url: 'https://www.youtube.com/', title: 'YouTube' }, { url: 'https://blog.com/you', title: 'you' }],
      searches: ['youtube music', 'you tube kids'],
    }));
    expect(s.map((x) => [x.kind, x.title])).toEqual([
      ['history', 'YouTube'], ['search', 'youtube music'], ['search', 'you tube kids'], ['history', 'you'],
    ]);
    expect(s[1].url).toBe('https://www.google.com/search?q=youtube%20music');
    expect(inlineCompletion('you', s[0])?.text).toBe('youtube.com');
  });

  it('sem site que completa: pesquisas primeiro; pesquisa nunca completa a barra', () => {
    const s = buildSuggestions('receita bolo', src({ history: [{ url: 'https://tudogostoso.com/bolo', title: 'Receita de bolo' }], searches: ['receita bolo de cenoura'] }));
    expect(s.map((x) => x.kind)).toEqual(['search', 'history']);
    expect(inlineCompletion('receita', s[0])).toBeNull();
  });
});
