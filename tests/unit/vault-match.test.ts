import { describe, expect, it } from 'vitest';
import { loginsFor, MATCH, uriMatches } from '../../src/main/vault/match';
import type { VaultLogin } from '../../src/main/vault/vault';

const u = (uri: string, match: number | null = null) => ({ uri, match });

describe('uriMatches (regras do Bitwarden)', () => {
  it('Domínio (padrão): mesmo domínio base, qualquer subdomínio', () => {
    expect(uriMatches(u('https://outlook.office.com/mail/'), 'https://outlook.office.com/owa/')).toBe(true);
    expect(uriMatches(u('https://office.com'), 'https://www.office.com/login')).toBe(true);
    expect(uriMatches(u('outlook.office.com'), 'https://outlook.office.com/')).toBe(true); // sem esquema
    expect(uriMatches(u('https://moodle.ufmg.br'), 'https://sistemas.ufmg.br/')).toBe(true);
    expect(uriMatches(u('https://office.com'), 'https://office.com.golpe.ru/')).toBe(false);
    expect(uriMatches(u('https://usuario.github.io'), 'https://outro.github.io/')).toBe(false); // domínios privados
  });

  it('Host: host e porta iguais', () => {
    expect(uriMatches(u('https://a.site.com', MATCH.Host), 'https://a.site.com/x')).toBe(true);
    expect(uriMatches(u('https://a.site.com', MATCH.Host), 'https://b.site.com/')).toBe(false);
    expect(uriMatches(u('https://a.site.com:8443', MATCH.Host), 'https://a.site.com/')).toBe(false);
  });

  it('Começa com, Exata, Regex e Nunca', () => {
    expect(uriMatches(u('https://a.com/app', MATCH.StartsWith), 'https://a.com/app/login')).toBe(true);
    expect(uriMatches(u('https://a.com/app', MATCH.StartsWith), 'https://a.com/outro')).toBe(false);
    expect(uriMatches(u('https://a.com/login', MATCH.Exact), 'https://a.com/login')).toBe(true);
    expect(uriMatches(u('https://a.com/login', MATCH.Exact), 'https://a.com/login?x=1')).toBe(false);
    expect(uriMatches(u('^https://(www\\.)?a\\.com/', MATCH.RegularExpression), 'https://www.a.com/x')).toBe(true);
    expect(uriMatches(u('([inválida', MATCH.RegularExpression), 'https://a.com/')).toBe(false);
    expect(uriMatches(u('https://a.com', MATCH.Never), 'https://a.com/')).toBe(false);
  });

  it('nunca oferece login https numa página http (rebaixamento)', () => {
    expect(uriMatches(u('https://banco.com'), 'http://banco.com/')).toBe(false);
    expect(uriMatches(u('http://roteador.lan'), 'http://roteador.lan/')).toBe(true);
  });

  it('páginas que não são web: nada', () => {
    expect(uriMatches(u('https://a.com'), 'apollo://home')).toBe(false);
    expect(uriMatches(u('https://a.com'), 'lixo')).toBe(false);
  });
});

describe('loginsFor', () => {
  const login = (name: string, username: string, ...uris: string[]): VaultLogin =>
    ({ id: name + username, name, username, uris: uris.map((x) => u(x)), hasTotp: false, organizationId: null });

  it('só os do site, em ordem alfabética', () => {
    const list = [login('Outlook pessoal', 'eu@outlook.com', 'https://outlook.live.com'),
      login('Outlook', 'eu@empresa.com', 'https://outlook.office.com'), login('Moodle', 'aluno', 'https://moodle.ufmg.br'),
      login('Office', 'admin', 'https://www.office.com')];
    expect(loginsFor(list, 'https://outlook.office.com/mail/').map((l) => l.name)).toEqual(['Office', 'Outlook']);
  });
});
