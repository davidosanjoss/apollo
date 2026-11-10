import { describe, expect, it } from 'vitest';
import { DEFAULT_READER_STYLE, nextReaderSize, parseReaderStyle, readerHtml, readingMinutes, styleVars } from '../../src/reader/template';

const art = { title: 'Cálculo <b>I</b> & "limites"', byline: 'Prof. <X>', siteName: 'UFMG', content: '<p>Texto</p>', length: 4300, lang: 'pt-BR' };

describe('página de leitura', () => {
  it('título e autor escapados; artigo dentro do main; proíbe scripts (CSP)', () => {
    const h = readerHtml(art, DEFAULT_READER_STYLE);
    expect(h).toContain('<title>Cálculo &lt;b&gt;I&lt;/b&gt; &amp; &quot;limites&quot;</title>');
    expect(h).toContain('UFMG · Prof. &lt;X&gt; · 4 min de leitura');
    expect(h).toContain('<main id="apollo-reader"><h1>Cálculo &lt;b&gt;I&lt;/b&gt;');
    expect(h).toContain("default-src 'none'");
    expect(h).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('estilo: tema, fonte e tamanho viram variáveis', () => {
    expect(styleVars({ size: 24, font: 'sans', theme: 'dark' })).toContain('--bg: #1b1b1f');
    expect(styleVars({ size: 24, font: 'sans', theme: 'dark' })).toContain('--size: 24px');
    expect(styleVars({ size: 24, font: 'serif', theme: 'sepia' })).toContain('Georgia');
  });

  it('estilo salvo inválido volta ao padrão; tamanho anda nos degraus com limite', () => {
    expect(parseReaderStyle('lixo')).toEqual(DEFAULT_READER_STYLE);
    expect(parseReaderStyle('{"size":99,"font":"comic","theme":"neon"}')).toEqual(DEFAULT_READER_STYLE);
    expect(parseReaderStyle('{"size":24,"font":"sans","theme":"sepia"}')).toEqual({ size: 24, font: 'sans', theme: 'sepia' });
    expect(nextReaderSize(19, 1)).toBe(21);
    expect(nextReaderSize(28, 1)).toBe(28);
    expect(nextReaderSize(15, -1)).toBe(15);
    expect(readingMinutes(100)).toBe(1);
  });
});
