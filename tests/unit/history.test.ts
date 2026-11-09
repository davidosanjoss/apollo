import { describe, expect, it } from 'vitest';
import { MAX_HISTORY_ENTRIES, parseHistory, sanitizeHistory, withNavigation } from '../../src/main/history';

const e = (url: string, title = '') => ({ url, title });

describe('sanitizeHistory', () => {
  it('vazio/inválido vira null', () => {
    expect(sanitizeHistory(null)).toBeNull();
    expect(sanitizeHistory({ index: 0, entries: [] })).toBeNull();
    expect(sanitizeHistory({ index: 0, entries: [e('javascript:alert(1)')] })).toBeNull();
  });

  it('mantém entradas restauráveis e o índice', () => {
    const h = { index: 1, entries: [e('https://a.com/'), e('https://b.com/'), e('apollo://home')] };
    expect(sanitizeHistory(h)).toEqual(h);
  });

  it('página de erro vira a URL original (sem pageState)', () => {
    const err = `apollo://error/?${new URLSearchParams({ url: 'https://caiu.com/x', code: '-105' })}`;
    expect(sanitizeHistory({ index: 0, entries: [{ url: err, title: 'Erro', pageState: 'abc' }] }))
      .toEqual({ index: 0, entries: [{ url: 'https://caiu.com/x', title: 'Erro' }] });
  });

  it('remove entradas não restauráveis ajustando o índice', () => {
    const h = { index: 2, entries: [e('data:text/html,x'), e('https://a.com/'), e('https://b.com/')] };
    expect(sanitizeHistory(h)).toEqual({ index: 1, entries: [e('https://a.com/'), e('https://b.com/')] });
  });

  it('índice fora do intervalo é corrigido', () => {
    expect(sanitizeHistory({ index: 99, entries: [e('https://a.com/')] })!.index).toBe(0);
    expect(sanitizeHistory({ index: -5, entries: [e('https://a.com/')] })!.index).toBe(0);
  });

  it(`limita a ${MAX_HISTORY_ENTRIES} entradas mantendo a atual e o passado recente`, () => {
    const entries = Array.from({ length: 120 }, (_, i) => e(`https://s.com/${i}`));
    const h = sanitizeHistory({ index: 100, entries })!;
    expect(h.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(h.entries[h.index].url).toBe('https://s.com/100');
    expect(h.entries[0].url).toBe('https://s.com/51');
    // Atual no começo: guarda o "avançar".
    const h2 = sanitizeHistory({ index: 0, entries })!;
    expect(h2.index).toBe(0);
    expect(h2.entries).toHaveLength(MAX_HISTORY_ENTRIES);
  });
});

describe('withNavigation', () => {
  it('sem histórico cria um novo', () => {
    expect(withNavigation(null, 'https://a.com/')).toEqual({ index: 0, entries: [e('https://a.com/')] });
  });

  it('descarta o "avançar" e vira a entrada atual', () => {
    const h = { index: 0, entries: [e('https://a.com/'), e('https://b.com/')] };
    expect(withNavigation(h, 'https://c.com/')).toEqual({ index: 1, entries: [e('https://a.com/'), e('https://c.com/')] });
  });
});

describe('parseHistory', () => {
  it('JSON inválido não quebra', () => {
    expect(parseHistory('{')).toBeNull();
    expect(parseHistory(null)).toBeNull();
    expect(parseHistory(JSON.stringify({ index: 0, entries: [e('https://a.com/')] }))!.entries).toHaveLength(1);
  });
});
