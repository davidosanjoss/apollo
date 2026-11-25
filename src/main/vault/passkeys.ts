// Pedidos de passkey vindos da página (navigator.credentials.create/get, pelo preload):
// validação estrita (a página é quem manda o texto), escolha das passkeys do cofre que
// servem e as respostas no formato que o script da página transforma em PublicKeyCredential.
import { b64url, credentialIdBytes, fromB64url, type Assertion, type Attestation } from './webauthn';
import type { VaultLogin, VaultPasskey } from './vault';

export interface CreateRequest {
  kind: 'create';
  id: number;
  rpId: string | undefined;
  rpName: string | null;
  userId: Buffer;
  userName: string | null;
  userDisplayName: string | null;
  challenge: Buffer;
  algs: number[];
  exclude: Buffer[];
  residentKey: boolean;
}

export interface GetRequest {
  kind: 'get';
  id: number;
  rpId: string | undefined;
  challenge: Buffer;
  allow: Buffer[];
  /** mediation "conditional": o site espera, sem janela, até o usuário escolher (menu da chave). */
  conditional: boolean;
}

export type PasskeyRequest = CreateRequest | GetRequest;

/** Resposta ao script da página. */
export type PasskeyResponse =
  | { ok: Record<string, unknown> }
  | { error: 'NotAllowedError' | 'InvalidStateError' | 'SecurityError' | 'NotSupportedError' | 'AbortError'; message: string }
  | { fallback: true };

export const notAllowed = (message = 'A operação foi cancelada ou não é permitida.'): PasskeyResponse => ({ error: 'NotAllowedError', message });

const B64URL = /^[A-Za-z0-9_-]*$/;
const bytes = (v: unknown, max: number, min = 0): Buffer | null => {
  if (typeof v !== 'string' || v.length > Math.ceil(max * 4 / 3) + 4 || !B64URL.test(v)) return null;
  const b = fromB64url(v);
  return b.length >= min && b.length <= max ? b : null;
};
const text = (v: unknown, max = 256): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const optText = (v: unknown, max = 256) => (v === undefined || v === null ? null : text(v, max));
const idList = (v: unknown): Buffer[] | null => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 64) return null;
  const out: Buffer[] = [];
  for (const x of v) { const b = bytes(x, 1023, 1); if (!b) return null; out.push(b); }
  return out;
};

/** Texto do pedido (JSON montado pelo script da página) → pedido validado, ou null. */
export function parseRequest(raw: unknown): PasskeyRequest | null {
  if (typeof raw !== 'string' || raw.length > 64_000) return null;
  let r: Record<string, unknown>;
  try { r = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (!r || typeof r !== 'object' || typeof r.id !== 'number' || !Number.isSafeInteger(r.id)) return null;
  const rpId = r.rpId === undefined || r.rpId === null ? undefined : text(r.rpId, 253) ?? null;
  if (rpId === null) return null;
  const challenge = bytes(r.challenge, 1024, 16);
  if (!challenge) return null;
  if (r.kind === 'get') {
    const allow = idList(r.allow);
    if (!allow) return null;
    return { kind: 'get', id: r.id, rpId, challenge, allow, conditional: r.conditional === true };
  }
  if (r.kind !== 'create') return null;
  const userId = bytes(r.userId, 64, 1);
  const exclude = idList(r.exclude);
  const userName = optText(r.userName);
  const userDisplayName = optText(r.userDisplayName);
  const rpName = optText(r.rpName);
  const algs = Array.isArray(r.algs) && r.algs.length <= 32 && r.algs.every((a) => Number.isSafeInteger(a)) ? (r.algs as number[]) : null;
  if (!userId || !exclude || !algs || (r.userName != null && userName === null) || (r.rpName != null && rpName === null)
    || (r.userDisplayName != null && userDisplayName === null)) return null;
  return { kind: 'create', id: r.id, rpId, rpName, userId, userName, userDisplayName, challenge, algs, exclude, residentKey: r.residentKey !== false };
}

export interface Candidate { itemId: string; itemName: string; passkey: VaultPasskey }

const sameId = (stored: string, raw: Buffer) => {
  try { return credentialIdBytes(stored).equals(raw); } catch { return false; }
};

/** Passkeys do cofre para o site (rpId); com lista do site, só as listadas. */
export function candidatesFor(logins: VaultLogin[], rpId: string, allow: Buffer[]): Candidate[] {
  const out: Candidate[] = [];
  for (const l of logins) {
    for (const p of l.passkeys) {
      if (p.rpId !== rpId) continue;
      if (allow.length && !allow.some((a) => sameId(p.credentialId, a))) continue;
      // Sem lista do site, só as que o site encontra sozinho (detectáveis).
      if (!allow.length && !p.discoverable) continue;
      out.push({ itemId: l.id, itemName: l.name, passkey: p });
    }
  }
  return out;
}

/** O site já tem uma destas passkeys no cofre (excludeCredentials)? */
export const alreadyRegistered = (logins: VaultLogin[], rpId: string, exclude: Buffer[]) =>
  exclude.length > 0 && logins.some((l) => l.passkeys.some((p) => p.rpId === rpId && exclude.some((e) => sameId(p.credentialId, e))));

export function assertionResponse(a: Assertion): PasskeyResponse {
  return { ok: {
    id: b64url(a.credentialId),
    clientDataJSON: b64url(a.clientDataJSON),
    authenticatorData: b64url(a.authenticatorData),
    signature: b64url(a.signature),
    userHandle: a.userHandle ? b64url(a.userHandle) : null,
  } };
}

export function attestationResponse(a: Attestation, residentKey: boolean): PasskeyResponse {
  return { ok: {
    id: b64url(a.credentialId),
    clientDataJSON: b64url(a.clientDataJSON),
    attestationObject: b64url(a.attestationObject),
    authenticatorData: b64url(a.authenticatorData),
    publicKey: b64url(a.publicKeySpki),
    publicKeyAlgorithm: -7,
    transports: ['hybrid', 'internal'],
    rk: residentKey,
  } };
}
