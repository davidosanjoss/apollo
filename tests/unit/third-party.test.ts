import { describe, expect, it } from 'vitest';
import { isThirdParty, sameParty } from '../../src/main/privacy/third-party';

describe('isThirdParty', () => {
  it('mesmo site (subdomínios) não é terceiro', () => {
    expect(isThirdParty('https://cdn.loja.com/a.js', 'https://www.loja.com/')).toBe(false);
  });

  it('outro site é terceiro', () => {
    expect(isThirdParty('https://tracker.net/p', 'https://www.loja.com/')).toBe(true);
    expect(isThirdParty('http://localhost:1/x', 'http://127.0.0.1:1/')).toBe(true);
  });

  it('login da Microsoft e do Google não é terceiro dos próprios serviços', () => {
    expect(isThirdParty('https://login.microsoftonline.com/x', 'https://outlook.office.com/mail/')).toBe(false);
    expect(isThirdParty('https://outlook.office365.com/owa', 'https://outlook.office.com/')).toBe(false);
    expect(isThirdParty('https://teams.microsoft.com/', 'https://www.office.com/')).toBe(false);
    expect(isThirdParty('https://accounts.google.com/', 'https://www.youtube.com/')).toBe(false);
    expect(isThirdParty('https://i.ytimg.com/vi/x.jpg', 'https://www.youtube.com/')).toBe(false);
  });

  it('empresas diferentes continuam terceiras; anúncio do Google não entra no grupo', () => {
    expect(isThirdParty('https://login.microsoftonline.com/', 'https://www.youtube.com/')).toBe(true);
    expect(isThirdParty('https://ad.doubleclick.net/x', 'https://www.youtube.com/')).toBe(true);
    expect(sameParty('google.com', 'doubleclick.net')).toBe(false);
  });

  it('sem página de origem conhecida: não interfere', () => {
    expect(isThirdParty('https://x.com/', null)).toBe(false);
    expect(isThirdParty('apollo://home', 'https://a.com/')).toBe(false);
  });
});
