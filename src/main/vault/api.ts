// Cliente HTTP do Bitwarden (bitwarden.com, bitwarden.eu ou servidor próprio/Vaultwarden).
import type { Kdf } from './crypto';

export interface ServerUrls { api: string; identity: string }

export type ServerChoice = 'us' | 'eu' | string;

export function serverUrls(server: ServerChoice): ServerUrls {
  if (server === 'us') return { api: 'https://api.bitwarden.com', identity: 'https://identity.bitwarden.com' };
  if (server === 'eu') return { api: 'https://api.bitwarden.eu', identity: 'https://identity.bitwarden.eu' };
  const base = new URL(server);
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
    throw new BitwardenError('server', 'O servidor precisa usar https://');
  }
  const root = base.toString().replace(/\/+$/, '');
  return { api: `${root}/api`, identity: `${root}/identity` };
}

export type BitwardenErrorCode =
  | 'server' | 'network' | 'invalid-credentials' | 'two-factor' | 'captcha' | 'new-device' | 'unauthorized' | 'unexpected';

export class BitwardenError extends Error {
  constructor(readonly code: BitwardenErrorCode, message: string) { super(message); }
}

export interface Device { id: string; name: string; type: number }

/** Bitwarden responde ora em PascalCase, ora em camelCase: lê ignorando a caixa. */
export function field<T = unknown>(obj: unknown, name: string): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  if (name in o) return o[name] as T;
  const lower = name.toLowerCase();
  const key = Object.keys(o).find((k) => k.toLowerCase() === lower);
  return key === undefined ? undefined : (o[key] as T);
}

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  /** Chave do usuário cifrada com a chave mestra esticada. */
  key: string | null;
  privateKey: string | null;
  kdf: Kdf | null;
}

export function kdfFrom(obj: unknown): Kdf | null {
  const type = field<number>(obj, 'Kdf');
  const iterations = field<number>(obj, 'KdfIterations');
  if (type === 0 && iterations) return { type: 0, iterations };
  if (type === 1 && iterations) {
    return { type: 1, iterations, memory: field<number>(obj, 'KdfMemory') ?? 64, parallelism: field<number>(obj, 'KdfParallelism') ?? 4 };
  }
  return null;
}

/** Mesmo critério do serverUrls (https, ou http só em localhost), sem lançar. */
export function validVaultServer(v: unknown): v is ServerChoice {
  if (typeof v !== 'string' || v.length > 512) return false;
  try { serverUrls(v); return true; } catch { return false; }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

export class BitwardenApi {
  constructor(private readonly urls: ServerUrls, private readonly fetchFn: FetchFn, private readonly device: Device) {}

  private async request(url: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      throw new BitwardenError('network', `sem conexão com o servidor (${(err as Error).message})`);
    }
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* não-JSON */ }
    if (res.ok) return body;
    throw tokenError(res.status, body);
  }

  async prelogin(email: string): Promise<Kdf> {
    const body = await this.request(`${this.urls.identity}/accounts/prelogin`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
    });
    const kdf = kdfFrom(body);
    if (!kdf) throw new BitwardenError('unexpected', 'resposta de prelogin sem parâmetros de KDF');
    return kdf;
  }

  private async token(form: Record<string, string>, extraHeaders: Record<string, string> = {}): Promise<TokenResponse> {
    const body = await this.request(`${this.urls.identity}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...extraHeaders },
      body: new URLSearchParams({
        ...form,
        deviceType: String(this.device.type),
        deviceIdentifier: this.device.id,
        deviceName: this.device.name,
      }).toString(),
    });
    const accessToken = field<string>(body, 'access_token');
    if (!accessToken) throw new BitwardenError('unexpected', 'resposta de login sem token');
    return {
      accessToken,
      expiresIn: field<number>(body, 'expires_in') ?? 3600,
      key: field<string>(body, 'Key') ?? null,
      privateKey: field<string>(body, 'PrivateKey') ?? null,
      kdf: kdfFrom(body),
    };
  }

  /** E-mail + hash da senha mestra (servidores próprios; o bitwarden.com pode exigir captcha). */
  loginPassword(email: string, masterPasswordHash: string): Promise<TokenResponse> {
    return this.token(
      { grant_type: 'password', username: email, password: masterPasswordHash, scope: 'api offline_access', client_id: 'desktop' },
      { 'auth-email': b64url(email) },
    );
  }

  /** Chave de API pessoal (como `bw login --apikey`): sem captcha nem verificação de dispositivo. */
  loginApiKey(clientId: string, clientSecret: string): Promise<TokenResponse> {
    return this.token({ grant_type: 'client_credentials', scope: 'api', client_id: clientId, client_secret: clientSecret });
  }

  sync(accessToken: string): Promise<unknown> {
    return this.request(`${this.urls.api}/sync?excludeDomains=true`, { headers: { authorization: `Bearer ${accessToken}` } });
  }
}

/** Traduz erros do /connect/token para algo que dá para mostrar ao usuário. */
export function tokenError(status: number, body: unknown): BitwardenError {
  if (status === 401) return new BitwardenError('unauthorized', 'sessão expirada');
  // Primeira mensagem NÃO vazia (servidores mandam error_description = "" e a real em message).
  const desc = [field(body, 'error_description'), field(field(body, 'ErrorModel'), 'Message'), field(body, 'message')]
    .find((v) => typeof v === 'string' && v.trim() !== '') as string | undefined ?? '';
  if (field(body, 'TwoFactorProviders2') || field(body, 'TwoFactorProviders')) {
    return new BitwardenError('two-factor', 'a conta exige login em duas etapas: use a chave de API');
  }
  if (field(body, 'HCaptcha_SiteKey')) return new BitwardenError('captcha', 'o servidor pediu captcha: use a chave de API');
  if (/new device|device verification/i.test(desc)) {
    return new BitwardenError('new-device', 'o servidor pediu verificação de dispositivo novo: use a chave de API');
  }
  if (status === 400 && /invalid_client|invalid_grant|username or password|invalid client|invalid/i.test(`${field(body, 'error') ?? ''} ${desc}`)) {
    return new BitwardenError('invalid-credentials', 'credenciais inválidas');
  }
  return new BitwardenError('server', `erro do servidor (HTTP ${status}${desc ? `: ${desc}` : ''})`);
}
