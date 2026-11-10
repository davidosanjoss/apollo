// Nuvem da sincronização: Google Drive (pasta oculta do app) ou OneDrive (pasta do app).
// O Apollo só enxerga essa pasta — nunca os arquivos do usuário. Login: OAuth 2.0 com
// PKCE e retorno para 127.0.0.1 (app instalado). `fetch` vem de fora (testável).
import { createHash, randomBytes } from 'node:crypto';

export type ProviderId = 'google' | 'onedrive';
export const PROVIDER_IDS: ProviderId[] = ['google', 'onedrive'];
export const PROVIDER_NAMES: Record<ProviderId, string> = { google: 'Google Drive', onedrive: 'OneDrive' };
export const SYNC_FILE = 'apollo-sync.json';

interface Endpoints { auth: string; token: string; api: string; upload: string }
const REAL: Record<ProviderId, Endpoints> = {
  google: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    api: 'https://www.googleapis.com', upload: 'https://www.googleapis.com' },
  onedrive: { auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    api: 'https://graph.microsoft.com', upload: 'https://graph.microsoft.com' },
};
const SCOPES: Record<ProviderId, string> = {
  google: 'https://www.googleapis.com/auth/drive.appdata',
  onedrive: 'Files.ReadWrite.AppFolder offline_access',
};

/** Testes de integração: um servidor falso no lugar do Google/Microsoft. */
export function endpoints(p: ProviderId, testServer = process.env.APOLLO_TEST_SYNC_SERVER): Endpoints {
  if (!testServer) return REAL[p];
  return { auth: `${testServer}/${p}/authorize`, token: `${testServer}/${p}/token`, api: `${testServer}/${p}`, upload: `${testServer}/${p}` };
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface Credentials { provider: ProviderId; clientId: string; clientSecret: string | null; refreshToken: string }

// ------------------------------------------------------------ OAuth (PKCE)

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function authUrl(p: ProviderId, clientId: string, redirect: string, state: string, challenge: string): string {
  const u = new URL(endpoints(p).auth);
  u.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES[p], state,
    code_challenge: challenge, code_challenge_method: 'S256',
    ...(p === 'google' ? { access_type: 'offline', prompt: 'consent' } : { prompt: 'select_account' }),
  }).toString();
  return u.toString();
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }

async function tokenRequest(fetch: Fetch, p: ProviderId, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(endpoints(p).token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({})) as TokenResponse;
  if (!res.ok || !body.access_token) throw new Error(`login recusado (${body.error_description || body.error || `HTTP ${res.status}`})`);
  return body;
}

export async function exchangeCode(fetch: Fetch, p: ProviderId, a: { clientId: string; clientSecret: string | null; code: string; verifier: string; redirect: string }) {
  return tokenRequest(fetch, p, {
    grant_type: 'authorization_code', code: a.code, redirect_uri: a.redirect, client_id: a.clientId, code_verifier: a.verifier,
    ...(a.clientSecret ? { client_secret: a.clientSecret } : {}),
  });
}

// ------------------------------------------------------------ arquivo na nuvem

export class CloudClient {
  private access: { token: string; until: number } | null = null;

  constructor(private readonly creds: Credentials, private readonly fetch: Fetch,
    /** A nuvem pode trocar o refresh token: guardar o novo. */
    private readonly onRefreshToken: (t: string) => void = () => {}) {}

  private async token(): Promise<string> {
    if (this.access && Date.now() < this.access.until) return this.access.token;
    const c = this.creds;
    const r = await tokenRequest(this.fetch, c.provider, {
      grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId,
      ...(c.clientSecret ? { client_secret: c.clientSecret } : {}),
      ...(c.provider === 'onedrive' ? { scope: SCOPES.onedrive } : {}),
    });
    if (r.refresh_token && r.refresh_token !== c.refreshToken) { c.refreshToken = r.refresh_token; this.onRefreshToken(r.refresh_token); }
    this.access = { token: r.access_token, until: Date.now() + Math.max(60, (r.expires_in ?? 3600) - 120) * 1000 };
    return r.access_token;
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await this.token()}` },
      signal: AbortSignal.timeout(30_000) });
    if (res.status === 401) this.access = null; // vence antes do previsto: tenta de novo na próxima
    return res;
  }

  private async googleFileId(): Promise<string | null> {
    const e = endpoints('google');
    const q = encodeURIComponent(`name='${SYNC_FILE}'`);
    const res = await this.call(`${e.api}/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
    if (!res.ok) throw new Error(`Google Drive: HTTP ${res.status}`);
    const body = await res.json() as { files?: { id: string }[] };
    return body.files?.[0]?.id ?? null;
  }

  /** Conteúdo do arquivo, ou null se ainda não existe. */
  async download(): Promise<Buffer | null> {
    if (this.creds.provider === 'google') {
      const id = await this.googleFileId();
      if (!id) return null;
      const res = await this.call(`${endpoints('google').api}/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
      if (!res.ok) throw new Error(`Google Drive: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    const res = await this.call(`${endpoints('onedrive').api}/v1.0/me/drive/special/approot:/${SYNC_FILE}:/content`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OneDrive: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async upload(data: Buffer): Promise<void> {
    if (this.creds.provider === 'google') {
      const e = endpoints('google');
      const id = await this.googleFileId();
      let res: Response;
      if (id) {
        res = await this.call(`${e.upload}/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media`,
          { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: new Uint8Array(data) });
      } else {
        const boundary = `apollo${randomBytes(8).toString('hex')}`;
        const meta = JSON.stringify({ name: SYNC_FILE, parents: ['appDataFolder'] });
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n`),
          data, Buffer.from(`\r\n--${boundary}--`),
        ]);
        res = await this.call(`${e.upload}/upload/drive/v3/files?uploadType=multipart`,
          { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body) });
      }
      if (!res.ok) throw new Error(`Google Drive: HTTP ${res.status}`);
      return;
    }
    const res = await this.call(`${endpoints('onedrive').upload}/v1.0/me/drive/special/approot:/${SYNC_FILE}:/content`,
      { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(data) });
    if (!res.ok) throw new Error(`OneDrive: HTTP ${res.status}`);
  }
}
