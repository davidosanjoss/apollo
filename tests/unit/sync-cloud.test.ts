import { describe, expect, it } from 'vitest';
import { authUrl, CloudClient, exchangeCode, pkce, type Fetch } from '../../src/main/sync/cloud';
import { createHash } from 'node:crypto';

type Call = { url: string; method: string; headers: Record<string, string>; body: string };
function fakeFetch(handler: (c: Call) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = [];
  const f: Fetch = async (url, init = {}) => {
    const body = init.body instanceof Uint8Array ? Buffer.from(init.body).toString() : String(init.body ?? '');
    const c = { url, method: init.method ?? 'GET', headers: (init.headers ?? {}) as Record<string, string>, body };
    calls.push(c);
    const r = handler(c);
    return new Response(r.json !== undefined ? JSON.stringify(r.json) : (r.text ?? null), { status: r.status ?? 200 });
  };
  return { f, calls };
}
const token = { json: { access_token: 'AT', expires_in: 3600 } };

describe('OAuth (PKCE)', () => {
  it('desafio = SHA-256 do verificador; URL com escopo só da pasta do app', () => {
    const { verifier, challenge } = pkce();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    const g = new URL(authUrl('google', 'cid', 'http://127.0.0.1:5000/callback', 'st', challenge));
    expect(g.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata');
    expect(g.searchParams.get('code_challenge_method')).toBe('S256');
    expect(g.searchParams.get('access_type')).toBe('offline');
    const o = new URL(authUrl('onedrive', 'cid', 'http://127.0.0.1:5000/callback', 'st', challenge));
    expect(o.searchParams.get('scope')).toBe('Files.ReadWrite.AppFolder offline_access');
  });

  it('troca o código pelo token (com o verificador); erro do provedor vira mensagem', async () => {
    const { f, calls } = fakeFetch(() => ({ json: { access_token: 'AT', refresh_token: 'RT' } }));
    const r = await exchangeCode(f, 'google', { clientId: 'cid', clientSecret: 'sec', code: 'C', verifier: 'V', redirect: 'http://127.0.0.1/cb' });
    expect(r.refresh_token).toBe('RT');
    expect(new URLSearchParams(calls[0].body).get('code_verifier')).toBe('V');
    const bad = fakeFetch(() => ({ status: 400, json: { error: 'invalid_grant', error_description: 'código expirado' } }));
    await expect(exchangeCode(bad.f, 'onedrive', { clientId: 'c', clientSecret: null, code: 'x', verifier: 'v', redirect: 'r' })).rejects.toThrow('código expirado');
  });
});

describe('arquivo na nuvem', () => {
  it('Google Drive: procura na pasta do app, baixa; sobe criando ou atualizando', async () => {
    let exists = false;
    const { f, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/token')) return token;
      if (c.method === 'POST') { exists = true; return { json: { id: 'F1' } }; }
      if (c.method === 'PATCH') return { json: { id: 'F1' } };
      if (c.url.includes('/drive/v3/files?')) return { json: { files: exists ? [{ id: 'F1' }] : [] } };
      if (c.url.includes('/drive/v3/files/F1?alt=media')) return { text: 'CONTEUDO' };
      return { json: {} };
    });
    const cloud = new CloudClient({ provider: 'google', clientId: 'cid', clientSecret: 's', refreshToken: 'RT' }, f);
    expect(await cloud.download()).toBeNull();
    await cloud.upload(Buffer.from('X'));
    expect(calls.at(-1)!.url).toContain('uploadType=multipart');
    expect(calls.at(-1)!.body).toContain('"parents":["appDataFolder"]');
    expect((await cloud.download())!.toString()).toBe('CONTEUDO');
    await cloud.upload(Buffer.from('Y'));
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH' });
    expect(calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(1); // token reaproveitado
    expect(calls.find((c) => c.url.includes('/drive/'))!.headers.authorization).toBe('Bearer AT');
  });

  it('OneDrive: 404 = ainda não existe; sobe com PUT na pasta do app; guarda refresh token novo', async () => {
    const saved: string[] = [];
    const { f, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/token')) return { json: { access_token: 'AT', refresh_token: 'RT2' } };
      if (c.method === 'GET') return { status: 404 };
      return { json: {} };
    });
    const cloud = new CloudClient({ provider: 'onedrive', clientId: 'cid', clientSecret: null, refreshToken: 'RT' }, f, (t) => saved.push(t));
    expect(await cloud.download()).toBeNull();
    await cloud.upload(Buffer.from('X'));
    expect(calls.at(-1)).toMatchObject({ method: 'PUT' });
    expect(calls.at(-1)!.url).toBe('https://graph.microsoft.com/v1.0/me/drive/special/approot:/apollo-sync.json:/content');
    expect(saved).toEqual(['RT2']);
  });
});
