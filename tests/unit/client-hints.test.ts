import { describe, expect, it } from 'vitest';
import { clientHintsModule, hintValues, parseAcceptCh, secureUrl } from '../../src/main/client-hints';
import { cleanUserAgent, needsNativeIdentity, setGoogleCompat, setNativeUserAgent, uaMetadata } from '../../src/main/user-agent';

const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.75 Safari/537.36';
const send = (m: ReturnType<typeof clientHintsModule>, url: string, headers: Record<string, string>) => {
  m.onBeforeSendHeaders!({ url } as never, headers, {} as never);
  return headers;
};

describe('identificação do navegador', () => {
  it('user agent sem Electron e sem o nome do app', () => {
    expect(cleanUserAgent(`${CHROME.replace(' Safari', ' apollo/0.7.0 Electron/45.2.1 Safari')}`)).toBe(CHROME);
  });

  it('metadados de um Chromium comum (não finge ser o Google Chrome)', () => {
    const m = uaMetadata('156.0.8078.75', false, 'linux', 'x64');
    expect(m.brands).toEqual([{ brand: 'Chromium', version: '156' }, { brand: 'Not-A.Brand', version: '24' }]);
    expect(m.brands.some((b) => /Google Chrome/.test(b.brand))).toBe(false);
    expect(m).toMatchObject({ platform: 'Linux', architecture: 'x86', bitness: '64', mobile: false });
    expect(uaMetadata('156.0.8078.75', true)).toMatchObject({ platform: 'Android', mobile: true });
  });
});

describe('client hints nas requisições', () => {
  // Regressão: com o user agent trocado, o Electron não mandava nenhuma (login do Google recusado).
  it('https recebe as básicas; http comum não; quem já tem não é alterado', () => {
    const m = clientHintsModule('156.0.8078.75');
    // Regressão (CI no Windows): a plataforma é a da máquina, não sempre "Linux".
    expect(send(m, 'https://accounts.google.com/', { 'User-Agent': CHROME })).toMatchObject({
      'sec-ch-ua': '"Chromium";v="156", "Not-A.Brand";v="24"', 'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': `"${uaMetadata('156.0.8078.75', false).platform}"` });
    expect(Object.keys(send(m, 'http://example.com/', { 'User-Agent': CHROME }))).toEqual(['User-Agent']);
    expect(send(m, 'https://a.com/', { 'User-Agent': CHROME, 'Sec-CH-UA': 'x' })).toEqual({ 'User-Agent': CHROME, 'Sec-CH-UA': 'x' });
  });

  it('as detalhadas só para quem pediu (Accept-CH); celular e outros navegadores', () => {
    const m = clientHintsModule('156.0.8078.75');
    m.onHeadersReceived!({ url: 'https://accounts.google.com/x' } as never, { 'Accept-CH': ['Sec-CH-UA-Full-Version-List, Sec-CH-UA-Arch, Viewport-Width'] }, {} as never);
    const h = send(m, 'https://accounts.google.com/y', { 'User-Agent': CHROME });
    expect(h['sec-ch-ua-full-version-list']).toBe('"Chromium";v="156.0.8078.75", "Not-A.Brand";v="24.0.0.0"');
    expect(h['sec-ch-ua-arch']).toBe('"x86"');
    expect(send(m, 'https://outro.com/', { 'User-Agent': CHROME })['sec-ch-ua-arch']).toBeUndefined();
    expect(send(m, 'https://a.com/', { 'User-Agent': `${CHROME} Android` })['sec-ch-ua-mobile']).toBe('?1');
    expect(Object.keys(send(m, 'https://a.com/', { 'User-Agent': 'Mozilla/5.0 (X11; rv:140.0) Gecko/20100101 Firefox/140.0' }))).toEqual(['User-Agent']);
  });

  it('auxiliares', () => {
    expect(secureUrl('http://localhost:3000/')).toBe(true);
    expect(secureUrl('http://192.168.0.1/')).toBe(false);
    expect(parseAcceptCh('Sec-CH-UA-Model, DPR')).toEqual(['sec-ch-ua-model']);
    expect(hintValues(uaMetadata('1.2.3.4', false))['sec-ch-ua-wow64']).toBe('?0');
  });
});

// Regressão: o Google recusava o Apollo "igual ao Chrome" (e também como Firefox); aceita a
// identificação original do Electron. Só nas páginas de login.
describe('login do Google: identificação original do Electron', () => {
  const NATIVE = CHROME.replace(' Safari', ' apollo/0.8.0 Electron/45.2.1 Safari');
  setNativeUserAgent(NATIVE);

  it('só accounts.google.com / accounts.youtube.com, só com a opção ligada', () => {
    setGoogleCompat(true);
    expect(needsNativeIdentity('https://accounts.google.com/v3/signin/identifier')).toBe(true);
    expect(needsNativeIdentity('https://accounts.youtube.com/accounts/SetSID')).toBe(true);
    expect(needsNativeIdentity('https://mail.google.com/')).toBe(false);
    setGoogleCompat(false);
    expect(needsNativeIdentity('https://accounts.google.com/')).toBe(false);
    setGoogleCompat(true);
  });

  it('a navegação para o login sai com a identificação original e client hints de Chromium; outros pedidos não mudam', () => {
    const m = clientHintsModule('156.0.8078.75');
    const nav: Record<string, string> = { 'User-Agent': CHROME };
    m.onBeforeSendHeaders!({ url: 'https://accounts.google.com/signin', resourceType: 'mainFrame' } as never, nav, {} as never);
    expect(nav['User-Agent']).toBe(NATIVE);
    expect(nav['sec-ch-ua']).toContain('"Chromium"');
    const xhr = { 'User-Agent': CHROME };
    m.onBeforeSendHeaders!({ url: 'https://accounts.google.com/ListAccounts', resourceType: 'xhr' } as never, xhr, {} as never);
    expect(xhr['User-Agent']).toBe(CHROME);
    const other: Record<string, string> = { 'User-Agent': CHROME };
    m.onBeforeSendHeaders!({ url: 'https://mail.google.com/', resourceType: 'mainFrame' } as never, other, {} as never);
    expect(other['User-Agent']).toBe(CHROME);
  });
});
