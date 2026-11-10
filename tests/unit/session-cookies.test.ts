import type { Cookie, CookiesSetDetails, Session } from 'electron';
import { describe, expect, it } from 'vitest';
import {
  captureSessionCookies, restoreSessionCookies, toSetDetails, toStored, type Cipher,
} from '../../src/main/session-cookies';

// Cifra de teste reversível (a real usa o chaveiro do sistema).
const cipher: Cipher = {
  encrypt: async (s) => Buffer.from(s, 'utf8').reverse(),
  decrypt: async (b) => Buffer.from(b).reverse().toString('utf8'),
};

const cookie = (over: Partial<Cookie>): Cookie => ({
  name: 'n', value: 'v', domain: 'login.exemplo.com', hostOnly: true, path: '/', secure: true,
  httpOnly: true, session: true, sameSite: 'no_restriction', ...over,
} as Cookie);

function fakeSession(cookies: Cookie[], reject: (d: CookiesSetDetails) => boolean = () => false) {
  const set: CookiesSetDetails[] = [];
  const ses = {
    cookies: {
      get: async () => cookies,
      set: async (d: CookiesSetDetails) => { if (reject(d)) throw new Error('recusado'); set.push(d); },
    },
  } as unknown as Session;
  return { ses, set };
}

describe('toStored / toSetDetails', () => {
  it('ignora cookies persistentes (o Chromium já guarda)', () => {
    expect(toStored(cookie({ session: false, expirationDate: 2e9 }))).toBeNull();
  });

  it('host-only: sem domínio, URL pelo host', () => {
    const d = toSetDetails(toStored(cookie({ name: 'ESTSAUTH', value: 'x' }))!);
    expect(d).toEqual({ url: 'https://login.exemplo.com/', name: 'ESTSAUTH', value: 'x', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction' });
    expect(d).not.toHaveProperty('expirationDate');
  });

  it('cookie de domínio mantém o domínio com ponto', () => {
    const d = toSetDetails(toStored(cookie({ domain: '.exemplo.com', hostOnly: false, secure: false, path: '/app' }))!);
    expect(d).toMatchObject({ url: 'http://exemplo.com/app', domain: '.exemplo.com', path: '/app', secure: false });
  });
});

describe('captura e restauração', () => {
  it('ida e volta: só os de sessão voltam, iguais', async () => {
    const { ses: from } = fakeSession([
      cookie({ name: 'a', value: '1' }),
      cookie({ name: 'b', value: '2', domain: '.x.com', hostOnly: false }),
      cookie({ name: 'persistente', session: false, expirationDate: 2e9 }),
    ]);
    const data = await captureSessionCookies(from, cipher);
    expect(data.toString('utf8')).not.toContain('"value"'); // não fica em texto puro

    const { ses: to, set } = fakeSession([]);
    expect(await restoreSessionCookies(to, data, cipher)).toBe(2);
    expect(set.map((c) => [c.name, c.value])).toEqual([['a', '1'], ['b', '2']]);
  });

  it('cookie recusado não impede os outros', async () => {
    const { ses: from } = fakeSession([cookie({ name: 'ruim' }), cookie({ name: 'bom' })]);
    const data = await captureSessionCookies(from, cipher);
    const { ses: to, set } = fakeSession([], (d) => d.name === 'ruim');
    expect(await restoreSessionCookies(to, data, cipher)).toBe(1);
    expect(set.map((c) => c.name)).toEqual(['bom']);
  });

  it('dado ilegível (chaveiro trocou) não quebra', async () => {
    const { ses, set } = fakeSession([]);
    const broken: Cipher = { encrypt: cipher.encrypt, decrypt: async () => { throw new Error('chave errada'); } };
    expect(await restoreSessionCookies(ses, Buffer.from('x'), broken)).toBe(0);
    expect(await restoreSessionCookies(ses, await cipher.encrypt('{"não":"lista"}'), cipher)).toBe(0);
    expect(set).toEqual([]);
  });
});
