import { describe, expect, it } from 'vitest';
import { cleanUrl } from '../../src/main/privacy/url-cleaning';

describe('cleanUrl', () => {
  it('remove parâmetros de rastreamento e mantém os outros', () => {
    expect(cleanUrl('https://loja.com/p?id=7&utm_source=ig&utm_medium=x&fbclid=abc')).toBe('https://loja.com/p?id=7');
    expect(cleanUrl('https://a.com/?gclid=1')).toBe('https://a.com/');
    expect(cleanUrl('https://a.com/x?q=livro&msclkid=9#secao')).toBe('https://a.com/x?q=livro#secao');
    expect(cleanUrl('https://a.com/?UTM_Campaign=x&ok=1')).toBe('https://a.com/?ok=1');
  });

  it('sem rastreamento: null (nada a fazer)', () => {
    expect(cleanUrl('https://a.com/?q=utm&page=2')).toBeNull();
    expect(cleanUrl('https://a.com/')).toBeNull();
  });

  it('não mexe em outros esquemas nem em lixo', () => {
    expect(cleanUrl('apollo://home?utm_source=x')).toBeNull();
    expect(cleanUrl('nada')).toBeNull();
  });

  it('limpar de novo não muda (sem laço de redirecionamento)', () => {
    const once = cleanUrl('https://a.com/?id=1&utm_source=x')!;
    expect(cleanUrl(once)).toBeNull();
  });
});
