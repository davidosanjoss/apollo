import type { OnBeforeRequestListenerDetails, OnBeforeSendHeadersListenerDetails, OnHeadersReceivedListenerDetails } from 'electron';
import { describe, expect, it } from 'vitest';
import { thirdPartyCookiesModule, urlCleaningModule } from '../../src/main/privacy/modules';
import { DEFAULT_TOGGLES } from '../../src/main/privacy/rules';

const ctx = (tabUrl: string | null) => ({ workspaceId: 'w', tabId: tabUrl ? 't' : null, tabUrl });
const ON = () => DEFAULT_TOGGLES;
const OFF = () => ({ ...DEFAULT_TOGGLES, thirdPartyCookies: false, urlCleaning: false });

describe('cookies de terceiros', () => {
  const send = (url: string, type = 'image') => ({ url, resourceType: type, referrer: '' }) as unknown as OnBeforeSendHeadersListenerDetails;
  const recv = (url: string, type = 'image') => ({ url, resourceType: type, referrer: '' }) as unknown as OnHeadersReceivedListenerDetails;

  it('terceiro: não envia nem aceita cookie', () => {
    const m = thirdPartyCookiesModule(ON);
    const h: Record<string, string> = { Cookie: 'id=1', Accept: '*/*' };
    m.onBeforeSendHeaders!(send('https://tracker.net/p'), h, ctx('https://loja.com/'));
    expect(h).toEqual({ Accept: '*/*' });
    const r: Record<string, string[]> = { 'set-cookie': ['id=2'], 'content-type': ['image/gif'] };
    m.onHeadersReceived!(recv('https://tracker.net/p'), r, ctx('https://loja.com/'));
    expect(r).toEqual({ 'content-type': ['image/gif'] });
  });

  it('mesmo site, mesma empresa (login Microsoft) e navegação principal: intocados', () => {
    const m = thirdPartyCookiesModule(ON);
    for (const [url, page, type] of [
      ['https://cdn.loja.com/x', 'https://loja.com/', 'image'],
      ['https://login.microsoftonline.com/x', 'https://outlook.office.com/', 'subFrame'],
      ['https://outro.com/', 'https://loja.com/', 'mainFrame'],
    ]) {
      const h: Record<string, string> = { Cookie: 'id=1' };
      m.onBeforeSendHeaders!(send(url, type), h, ctx(page));
      expect(h, url).toEqual({ Cookie: 'id=1' });
    }
  });

  it('liberado no site: intocado', () => {
    const h: Record<string, string> = { Cookie: 'id=1' };
    thirdPartyCookiesModule(OFF).onBeforeSendHeaders!(send('https://tracker.net/p'), h, ctx('https://loja.com/'));
    expect(h).toEqual({ Cookie: 'id=1' });
  });
});

describe('limpeza de URL', () => {
  const req = (url: string, type = 'mainFrame', method = 'GET') => ({ url, resourceType: type, method }) as unknown as OnBeforeRequestListenerDetails;

  it('navegação principal com rastreio: redireciona para a limpa', () => {
    expect(urlCleaningModule(ON).onBeforeRequest!(req('https://a.com/?id=1&fbclid=x'), ctx(null)))
      .toEqual({ redirectURL: 'https://a.com/?id=1' });
  });

  it('não mexe em subrequisições, POST, URL limpa ou quando desligado', () => {
    const m = urlCleaningModule(ON);
    expect(m.onBeforeRequest!(req('https://a.com/api?utm_source=x', 'xhr'), ctx('https://a.com/'))).toBeUndefined();
    expect(m.onBeforeRequest!(req('https://a.com/?utm_source=x', 'mainFrame', 'POST'), ctx(null))).toBeUndefined();
    expect(m.onBeforeRequest!(req('https://a.com/?id=1'), ctx(null))).toBeUndefined();
    expect(urlCleaningModule(OFF).onBeforeRequest!(req('https://a.com/?utm_source=x'), ctx(null))).toBeUndefined();
  });
});
