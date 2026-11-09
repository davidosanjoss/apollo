import { describe, expect, it } from 'vitest';
import { normalizeUrl, SEARCH_URL } from '../../src/shared/url';

const search = (q: string) => SEARCH_URL + encodeURIComponent(q);

describe('normalizeUrl (barra de endereço)', () => {
  it('ignora texto vazio', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
  });

  it('mantém URLs completas', () => {
    expect(normalizeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeUrl('apollo://home')).toBe('apollo://home');
    expect(normalizeUrl('about:blank')).toBe('about:blank');
  });

  it('completa domínios com https', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
    expect(normalizeUrl('  outlook.office.com/mail  ')).toBe('https://outlook.office.com/mail');
  });

  it('pesquisa quando não parece endereço', () => {
    expect(normalizeUrl('como fazer pão')).toBe(search('como fazer pão'));
    expect(normalizeUrl('electron')).toBe(search('electron'));
    expect(normalizeUrl('node.js tutorial')).toBe(search('node.js tutorial'));
  });

  // Regressão: "localhost:3000" e "dominio:porta" eram confundidos com esquema
  // ("localhost:" parecia "https:") e a navegação não acontecia.
  it('localhost com e sem porta vira http', () => {
    expect(normalizeUrl('localhost')).toBe('http://localhost');
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeUrl('localhost:5173/app')).toBe('http://localhost:5173/app');
  });

  it('domínio com porta vira https', () => {
    expect(normalizeUrl('example.com:8443')).toBe('https://example.com:8443');
    expect(normalizeUrl('example.com:8443/x')).toBe('https://example.com:8443/x');
  });

  // Regressão: IPs iam para a pesquisa do Google.
  it('endereço IP vira http (rede local, roteador)', () => {
    expect(normalizeUrl('192.168.0.1')).toBe('http://192.168.0.1');
    expect(normalizeUrl('10.0.0.5:8080/admin')).toBe('http://10.0.0.5:8080/admin');
  });

  // Regressão: "c++: dúvida" parecia esquema "c++:" e não pesquisava.
  it('texto com dois-pontos que não é esquema vira pesquisa', () => {
    expect(normalizeUrl('c++: ponteiros')).toBe(search('c++: ponteiros'));
    expect(normalizeUrl('nota:10')).toBe(search('nota:10'));
  });
});
