// Passkeys (WebAuthn) guardadas no Bitwarden: o Apollo faz o papel do autenticador, como a
// extensão do Bitwarden faz no Chrome. Parte pura e testável: CBOR, dados do autenticador,
// assinatura de login, atestado de criação e as regras de quem pode usar qual passkey.
import crypto from 'node:crypto';
import { getDomain } from 'tldts';

/** AAGUID do Bitwarden: o site vê a passkey como "do Bitwarden" (é onde ela fica guardada). */
export const BITWARDEN_AAGUID = Buffer.from('d548826e79b4db40a3d811116f7e8349', 'hex');

export const COSE_ES256 = -7;

// ------------------------------------------------------------ base64url

export const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');
export const fromB64url = (s: string) => Buffer.from(s, 'base64url');

// ------------------------------------------------------------ CBOR (só o necessário: atestado e chave COSE)

type Cbor = number | string | Uint8Array | Map<number | string, Cbor> | Cbor[];

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}

export function cborEncode(v: Cbor): Buffer {
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('CBOR: só inteiros');
    return v >= 0 ? head(0, v) : head(1, -1 - v);
  }
  if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, s.length), s]); }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cborEncode)]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cborEncode(k), cborEncode(x)])]);
}

// ------------------------------------------------------------ identificadores do Bitwarden

/** Id da passkey como o Bitwarden guarda (GUID, ou "b64.<base64url>" quando importada) → bytes. */
export function credentialIdBytes(stored: string): Buffer {
  if (stored.startsWith('b64.')) return fromB64url(stored.slice(4));
  const hex = stored.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('id de passkey inválido');
  return Buffer.from(hex, 'hex');
}

/** Bytes → como o Bitwarden guarda (16 bytes viram GUID, como as passkeys criadas por ele). */
export function credentialIdStored(raw: Uint8Array): string {
  if (raw.length !== 16) return `b64.${b64url(raw)}`;
  const h = Buffer.from(raw).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ------------------------------------------------------------ quem pode usar qual passkey

/**
 * O site (origem) pode usar passkeys do rpId pedido? Como o Chromium: só https (ou
 * localhost), o rpId é o próprio host ou um domínio acima dele, e nunca um sufixo
 * público ("com.br", "github.io"). Devolve o rpId efetivo ou null.
 */
export function effectiveRpId(origin: string, requested: string | undefined): string | null {
  let u: URL;
  try { u = new URL(origin); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const local = host === 'localhost' || host.endsWith('.localhost');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (/^[\d.]+$/.test(host) || host.includes(':')) return null; // IP não pode ter passkey
  const rp = (requested ?? host).toLowerCase();
  if (rp !== host && !host.endsWith(`.${rp}`)) return null;
  if (!local && rp !== host) {
    const registrable = getDomain(host, { allowPrivateDomains: true });
    if (!registrable || !(rp === registrable || rp.endsWith(`.${registrable}`))) return null;
  }
  if (!local && !getDomain(rp, { allowPrivateDomains: true })) return null; // sufixo público
  return rp;
}

// ------------------------------------------------------------ dados do autenticador

const FLAG_UP = 0x01; // usuário presente
const FLAG_UV = 0x04; // usuário verificado (cofre desbloqueado + confirmação no Apollo)
const FLAG_BE = 0x08; // pode ter cópia (passkey sincronizada)
const FLAG_BS = 0x10; // tem cópia
const FLAG_AT = 0x40; // traz a chave nova (criação)

export function authenticatorData(rpId: string, counter: number, uv: boolean, attested?: Buffer): Buffer {
  const flags = FLAG_UP | (uv ? FLAG_UV : 0) | FLAG_BE | FLAG_BS | (attested ? FLAG_AT : 0);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(counter >>> 0);
  return Buffer.concat([sha256(rpId), Buffer.from([flags]), c, attested ?? Buffer.alloc(0)]);
}

const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest();

export function clientDataJSON(type: 'webauthn.get' | 'webauthn.create', challenge: Uint8Array, origin: string, crossOrigin = false): Buffer {
  // Ordem dos campos como o Chromium (alguns servidores comparam o texto).
  return Buffer.from(JSON.stringify({ type, challenge: b64url(challenge), origin, crossOrigin }), 'utf8');
}

/** Chave pública P-256 em COSE (vai no atestado). */
export function coseKey(publicKey: crypto.KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' });
  return cborEncode(new Map<number, Cbor>([
    [1, 2], [3, COSE_ES256], [-1, 1], [-2, fromB64url(jwk.x!)], [-3, fromB64url(jwk.y!)],
  ]));
}

// ------------------------------------------------------------ login (navigator.credentials.get)

export interface Assertion {
  credentialId: Buffer;
  clientDataJSON: Buffer;
  authenticatorData: Buffer;
  signature: Buffer;
  userHandle: Buffer | null;
}

export function makeAssertion(o: {
  privateKeyPkcs8: Buffer; credentialId: Buffer; userHandle: Buffer | null; rpId: string; origin: string;
  challenge: Uint8Array; counter: number; uv: boolean; crossOrigin?: boolean;
}): Assertion {
  const cd = clientDataJSON('webauthn.get', o.challenge, o.origin, o.crossOrigin);
  const ad = authenticatorData(o.rpId, o.counter, o.uv);
  const key = crypto.createPrivateKey({ key: o.privateKeyPkcs8, format: 'der', type: 'pkcs8' });
  const signature = crypto.sign('sha256', Buffer.concat([ad, sha256(cd)]), { key, dsaEncoding: 'der' });
  return { credentialId: o.credentialId, clientDataJSON: cd, authenticatorData: ad, signature, userHandle: o.userHandle };
}

// ------------------------------------------------------------ criação (navigator.credentials.create)

export interface Attestation {
  credentialId: Buffer;
  clientDataJSON: Buffer;
  attestationObject: Buffer;
  authenticatorData: Buffer;
  publicKeySpki: Buffer;
  /** Chave privada nova (PKCS#8): vai cifrada para o cofre; zerar depois. */
  privateKeyPkcs8: Buffer;
}

export function makeAttestation(o: { rpId: string; origin: string; challenge: Uint8Array; uv: boolean; crossOrigin?: boolean }): Attestation {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = crypto.randomBytes(16); // como o Bitwarden: um GUID
  const idLen = Buffer.alloc(2);
  idLen.writeUInt16BE(credentialId.length);
  const attested = Buffer.concat([BITWARDEN_AAGUID, idLen, credentialId, coseKey(publicKey)]);
  const ad = authenticatorData(o.rpId, 0, o.uv, attested);
  const attestationObject = cborEncode(new Map<string, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
  return {
    credentialId,
    clientDataJSON: clientDataJSON('webauthn.create', o.challenge, o.origin, o.crossOrigin),
    attestationObject,
    authenticatorData: ad,
    publicKeySpki: publicKey.export({ format: 'der', type: 'spki' }),
    privateKeyPkcs8: privateKey.export({ format: 'der', type: 'pkcs8' }),
  };
}

/** Algoritmos que o site aceita incluem ES256 (o único que o Bitwarden cria)? Lista vazia = padrão (aceita). */
export const acceptsEs256 = (algs: number[]) => algs.length === 0 || algs.includes(COSE_ES256);
