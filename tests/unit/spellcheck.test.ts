import { describe, expect, it } from 'vitest';
import { parseSpellcheck, spellcheckLanguages } from '../../src/main/spellcheck';

describe('corretor ortográfico', () => {
  it('padrão: português e inglês (antes baixava só inglês)', () => {
    expect(parseSpellcheck(null)).toBe('pt-en');
    expect(spellcheckLanguages('pt-en')).toEqual(['pt-BR', 'en-US']);
  });
  it('só português; desligado = nenhum idioma (nada baixado)', () => {
    expect(spellcheckLanguages('pt')).toEqual(['pt-BR']);
    expect(spellcheckLanguages('off')).toEqual([]);
  });
  it('valor salvo inválido vira o padrão', () => {
    expect(parseSpellcheck('klingon')).toBe('pt-en');
    expect(parseSpellcheck('off')).toBe('off');
  });
});
