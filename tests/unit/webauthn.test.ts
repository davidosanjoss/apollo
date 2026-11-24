import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BITWARDEN_AAGUID, acceptsEs256, authenticatorData, cborEncode, credentialIdBytes, credentialIdStored,
  effectiveRpId, makeAssertion, makeAttestation,
} from '../../src/main/vault/webauthn';

/** Decodificador CBOR mínimo (só para conferir o que o Apollo gera). */
function cborDecode(buf: Buffer): unknown {
  let p = 0;
  const len = (info: number) => {
    if (info < 24) return info;
    if (info === 24) return buf[p++];
    if (info === 25) { const v = buf.readUInt16BE(p); p += 2; return v; }
    const v = buf.readUInt32BE(p); p += 4; return v;
  };
  const item = (): unknown => {
    const b = buf[p++];
    const major = b >> 5;
    const n = len(b & 31);
    if (major === 0) return n;
    if (major === 1) return -1 - n;
    if (major === 2) { const v = buf.subarray(p, p + n); p += n; return Buffer.from(v); }
    if (major === 3) { const v = buf.toString('utf8', p, p + n); p += n; return v; }
    if (major === 4) return Array.from({ length: n }, item);
    const m = new Map<unknown, unknown>();
    for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); }
    return m;
  };
  return item();
}

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest();

describe('passkeys: identificadores e regras', () => {
  it('id do Bitwarden: GUID ↔ 16 bytes; importado: b64.', () => {
    const guid = '0f8e7b3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
    expect(credentialIdStored(credentialIdBytes(guid))).toBe(guid);
    const other = Buffer.from('uma credencial de outro gerenciador');
    expect(credentialIdStored(other)).toBe(`b64.${other.toString('base64url')}`);
    expect(credentialIdBytes(credentialIdStored(other))).toEqual(other);
    expect(() => credentialIdBytes('nao-e-guid')).toThrow();
  });

  it('rpId: o próprio host ou domínio acima; nunca sufixo público, IP ou http', () => {
    expect(effectiveRpId('https://login.microsoft.com', undefined)).toBe('login.microsoft.com');
    expect(effectiveRpId('https://login.microsoft.com', 'microsoft.com')).toBe('microsoft.com');
    expect(effectiveRpId('https://login.microsoft.com', 'live.com')).toBeNull(); // outro site
    expect(effectiveRpId('https://evil-microsoft.com', 'microsoft.com')).toBeNull();
    expect(effectiveRpId('https://banco.com.br', 'com.br')).toBeNull(); // sufixo público
    expect(effectiveRpId('https://eu.github.io', 'github.io')).toBeNull(); // sufixo privado (cada um é um site)
    expect(effectiveRpId('http://exemplo.com', undefined)).toBeNull(); // sem https
    expect(effectiveRpId('https://192.168.0.1', undefined)).toBeNull();
    expect(effectiveRpId('http://localhost:3000', 'localhost')).toBe('localhost'); // desenvolvimento
  });

  it('só cria ES256 (o que o Bitwarden usa)', () => {
    expect(acceptsEs256([-7, -257])).toBe(true);
    expect(acceptsEs256([])).toBe(true);
    expect(acceptsEs256([-257])).toBe(false);
  });

  it('CBOR: inteiros negativos, bytes, texto e mapas', () => {
    expect(cborEncode(-7).toString('hex')).toBe('26');
    expect(cborEncode(500).toString('hex')).toBe('1901f4');
    expect(cborDecode(cborEncode(new Map<number | string, never>([[1, 2 as never], ['a', 'b' as never]])))).toEqual(new Map<unknown, unknown>([[1, 2], ['a', 'b']]));
  });
});

describe('passkeys: criar e entrar (como o site confere)', () => {
  const origin = 'https://app.exemplo.com';
  const challenge = crypto.randomBytes(32);

  it('criação: atestado "none" com a chave pública que assina os logins', () => {
    const att = makeAttestation({ rpId: 'exemplo.com', origin, challenge, uv: true });
    const obj = cborDecode(att.attestationObject) as Map<string, unknown>;
    expect(obj.get('fmt')).toBe('none');
    const ad = obj.get('authData') as Buffer;
    expect(ad).toEqual(att.authenticatorData);
    expect(ad.subarray(0, 32)).toEqual(sha('exemplo.com'));
    expect(ad[32]).toBe(0x01 | 0x04 | 0x08 | 0x10 | 0x40); // UP UV BE BS AT
    expect(ad.readUInt32BE(33)).toBe(0);
    expect(ad.subarray(37, 53)).toEqual(BITWARDEN_AAGUID);
    expect(ad.readUInt16BE(53)).toBe(16);
    expect(ad.subarray(55, 71)).toEqual(att.credentialId);
    const cose = cborDecode(ad.subarray(71)) as Map<number, unknown>;
    expect([cose.get(1), cose.get(3), cose.get(-1)]).toEqual([2, -7, 1]);
    // A chave COSE é a mesma da SPKI devolvida ao site.
    const jwk = crypto.createPublicKey({ key: att.publicKeySpki, format: 'der', type: 'spki' }).export({ format: 'jwk' });
    expect((cose.get(-2) as Buffer).toString('base64url')).toBe(jwk.x);
    expect(JSON.parse(att.clientDataJSON.toString())).toEqual({ type: 'webauthn.create', challenge: challenge.toString('base64url'), origin, crossOrigin: false });

    // Login com a chave criada: a assinatura confere com a chave pública que o site guardou.
    const userHandle = Buffer.from('usuario-42');
    const as = makeAssertion({ privateKeyPkcs8: att.privateKeyPkcs8, credentialId: att.credentialId, userHandle,
      rpId: 'exemplo.com', origin, challenge, counter: 0, uv: true });
    const pub = crypto.createPublicKey({ key: att.publicKeySpki, format: 'der', type: 'spki' });
    expect(crypto.verify('sha256', Buffer.concat([as.authenticatorData, sha(as.clientDataJSON)]), { key: pub, dsaEncoding: 'der' }, as.signature)).toBe(true);
    expect(as.authenticatorData).toEqual(authenticatorData('exemplo.com', 0, true));
    expect(as.authenticatorData.length).toBe(37); // sem chave nova no login
    expect(JSON.parse(as.clientDataJSON.toString()).type).toBe('webauthn.get');
    expect(as.userHandle).toEqual(userHandle);
  });

  it('contador vai no login; sem verificação, sem a flag UV', () => {
    const ad = authenticatorData('exemplo.com', 7, false);
    expect(ad[32]).toBe(0x01 | 0x08 | 0x10);
    expect(ad.readUInt32BE(33)).toBe(7);
  });
});
