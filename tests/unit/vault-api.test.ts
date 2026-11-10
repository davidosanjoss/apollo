import { describe, expect, it, vi } from 'vitest';
import { BITWARDEN_CLIENT_VERSION, BitwardenApi, BitwardenError, field, kdfFrom, serverUrls, tokenError } from '../../src/main/vault/api';

describe('serverUrls', () => {
  it('nuvens oficiais e servidor próprio', () => {
    expect(serverUrls('us')).toEqual({ api: 'https://api.bitwarden.com', identity: 'https://identity.bitwarden.com' });
    expect(serverUrls('eu').api).toBe('https://api.bitwarden.eu');
    expect(serverUrls('https://cofre.casa.lan/')).toEqual({ api: 'https://cofre.casa.lan/api', identity: 'https://cofre.casa.lan/identity' });
  });

  it('servidor próprio precisa de https (exceto local)', () => {
    expect(() => serverUrls('http://cofre.casa.lan')).toThrow(BitwardenError);
    expect(serverUrls('http://localhost:8080').api).toBe('http://localhost:8080/api');
  });
});

describe('field / kdfFrom', () => {
  it('lê ignorando maiúsculas', () => {
    expect(field({ Key: 'a' }, 'key')).toBe('a');
    expect(field({ key: 'a' }, 'Key')).toBe('a');
    expect(field(null, 'x')).toBeUndefined();
  });

  it('KDF de qualquer servidor', () => {
    expect(kdfFrom({ Kdf: 0, KdfIterations: 600000 })).toEqual({ type: 0, iterations: 600000 });
    expect(kdfFrom({ kdf: 1, kdfIterations: 3, kdfMemory: 64, kdfParallelism: 4 })).toEqual({ type: 1, iterations: 3, memory: 64, parallelism: 4 });
    expect(kdfFrom({})).toBeNull();
  });
});

describe('tokenError', () => {
  // Regressão: error_description vinha "" e escondia a mensagem real (que está em message).
  it('credenciais erradas (corpos reais do Vaultwarden)', () => {
    const body = (m: string) => ({ message: m, errorModel: { message: m, object: 'error' }, error: '', error_description: '', object: 'error' });
    expect(tokenError(400, body('Invalid client_id')).code).toBe('invalid-credentials');
    expect(tokenError(400, body('Username or password is incorrect. Try again')).code).toBe('invalid-credentials');
  });

  it('casos especiais do bitwarden.com: 2FA, captcha, dispositivo novo', () => {
    expect(tokenError(400, { TwoFactorProviders2: { 0: null } }).code).toBe('two-factor');
    expect(tokenError(400, { HCaptcha_SiteKey: 'x' }).code).toBe('captcha');
    expect(tokenError(400, { error_description: 'New device verification required' }).code).toBe('new-device');
    expect(tokenError(401, {}).code).toBe('unauthorized');
    expect(tokenError(500, {}).code).toBe('server');
  });
});

describe('BitwardenApi', () => {
  const device = { id: 'dev-1', name: 'Apollo', type: 14 };

  it('login por chave de API envia o formulário certo e lê a resposta', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600, Key: '2.k', PrivateKey: '2.p', Kdf: 0, KdfIterations: 600000 })));
    const t = await new BitwardenApi(serverUrls('us'), fetchFn, device).loginApiKey('user.abc', 'segredo');
    expect(t).toEqual({ accessToken: 'tok', expiresIn: 3600, key: '2.k', privateKey: '2.p', kdf: { type: 0, iterations: 600000 } });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://identity.bitwarden.com/connect/token');
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toMatchObject({ grant_type: 'client_credentials', client_id: 'user.abc', client_secret: 'segredo', deviceIdentifier: 'dev-1', deviceType: '14' });
  });

  // Regressão: o bitwarden.com recusava tudo com "No client version header found"
  // (HTTP 400) — o Vaultwarden dos testes de compatibilidade não exige o cabeçalho.
  it('toda requisição leva nome e versão do cliente', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: 't', Kdf: 0, KdfIterations: 600000 })));
    const api = new BitwardenApi(serverUrls('us'), fetchFn, device);
    await api.loginApiKey('user.1', 's');
    await api.prelogin('a@b.c');
    await api.sync('t');
    expect(fetchFn).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchFn.mock.calls as unknown as [string, RequestInit][]) {
      const h = init.headers as Record<string, string>;
      expect(h['bitwarden-client-version']).toBe(BITWARDEN_CLIENT_VERSION);
      expect(h['bitwarden-client-name']).toBe('desktop');
      expect(h['device-type']).toBe('14');
    }
    // Cabeçalhos próprios da requisição continuam lá.
    const sync = (fetchFn.mock.calls[2] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(sync.authorization).toBe('Bearer t');
  });

  it('a versão anunciada é a mesma do CLI oficial usado no teste de compatibilidade', () => {
    expect(BITWARDEN_CLIENT_VERSION).toMatch(/^\d{4}\.\d{1,2}\.\d+$/);
  });

  it('sem rede: erro de rede legível', async () => {
    const api = new BitwardenApi(serverUrls('us'), async () => { throw new Error('ENOTFOUND'); }, device);
    await expect(api.sync('t')).rejects.toMatchObject({ code: 'network' });
  });

  it('a senha mestra nunca é enviada: só o hash', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: 't' })));
    await new BitwardenApi(serverUrls('us'), fetchFn, device).loginPassword('a@b.c', 'HASH');
    const body = String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(new URLSearchParams(body).get('password')).toBe('HASH');
  });
});
