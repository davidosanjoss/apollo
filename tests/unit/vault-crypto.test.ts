import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decrypt, decryptString, encrypt, hashMasterPassword, hkdfExpand, makeAccountKeys, makeMasterKey, parseEncString,
  rsaDecrypt, rsaEncrypt, stretchMasterKey, symKeyFrom, wipe, VaultCryptoError,
} from '../../src/main/vault/crypto';

describe('HKDF-Expand (RFC 5869, caso de teste 1)', () => {
  it('bate com o vetor oficial', () => {
    const prk = Buffer.from('077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5', 'hex');
    const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex');
    expect(hkdfExpand(prk, info, 42).toString('hex'))
      .toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });
});

describe('chave mestra', () => {
  it('PBKDF2: e-mail normalizado é o salt (bate com PBKDF2 puro)', async () => {
    const k = await makeMasterKey('senha', '  User@Example.COM ', { type: 0, iterations: 5000 });
    expect(k.equals(crypto.pbkdf2Sync('senha', 'user@example.com', 5000, 32, 'sha256'))).toBe(true);
  });

  it('Argon2id: salt = SHA-256(e-mail); bate com o Argon2 nativo do Node', async () => {
    const kdf = { type: 1 as const, iterations: 3, memory: 16, parallelism: 2 };
    const k = await makeMasterKey('senha', 'User@Example.com', kdf);
    const ref = crypto.argon2Sync('argon2id', { message: Buffer.from('senha'), nonce: crypto.createHash('sha256').update('user@example.com').digest(),
      parallelism: 2, tagLength: 32, memory: 16 * 1024, passes: 3 });
    expect(k.equals(ref)).toBe(true);
  });

  it('recusa KDF fraco (servidor malicioso não consegue baixar a proteção)', async () => {
    await expect(makeMasterKey('s', 'a@b.c', { type: 0, iterations: 1 })).rejects.toThrow(VaultCryptoError);
    await expect(makeMasterKey('s', 'a@b.c', { type: 1, iterations: 1, memory: 1, parallelism: 1 })).rejects.toThrow(VaultCryptoError);
  });

  it('hash do login = PBKDF2(chave mestra, senha, 1)', () => {
    const mk = Buffer.alloc(32, 7);
    expect(hashMasterPassword(mk, 'senha')).toBe(crypto.pbkdf2Sync(mk, 'senha', 1, 32, 'sha256').toString('base64'));
  });

  it('chave esticada = HKDF-Expand "enc" e "mac"', () => {
    const mk = Buffer.alloc(32, 9);
    const s = stretchMasterKey(mk);
    expect(s.enc.equals(crypto.createHmac('sha256', mk).update(Buffer.from('enc\x01')).digest())).toBe(true);
    expect(s.mac!.equals(crypto.createHmac('sha256', mk).update(Buffer.from('mac\x01')).digest())).toBe(true);
  });
});

describe('EncString', () => {
  const key = symKeyFrom(crypto.randomBytes(64));

  it('cifra e decifra (tipo 2)', () => {
    const s = encrypt('minha senha 🔑', key);
    expect(s).toMatch(/^2\.[^|]+\|[^|]+\|[^|]+$/);
    expect(decryptString(s, key)).toBe('minha senha 🔑');
  });

  it('MAC inválido: recusa (chave errada ou adulteração)', () => {
    const s = encrypt('x', key);
    const [head, data, mac] = s.split('|');
    const flipped = Buffer.from(data, 'base64'); flipped[0] ^= 1;
    expect(() => decrypt(`${head}|${flipped.toString('base64')}|${mac}`, key)).toThrow(/MAC/);
    expect(() => decrypt(s, symKeyFrom(crypto.randomBytes(64)))).toThrow(/MAC/);
  });

  it('formatos inválidos', () => {
    expect(() => parseEncString('lixo')).toThrow(VaultCryptoError);
    expect(() => parseEncString('2.a|b')).toThrow(VaultCryptoError);
    expect(() => parseEncString('9.a')).toThrow(VaultCryptoError);
    expect(() => decrypt('4.' + Buffer.from('x').toString('base64'), key)).toThrow(/não simétrico/);
  });

  it('RSA-OAEP: chave de organização cifrada com a pública, aberta com a privada', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'der' } });
    const orgKey = crypto.randomBytes(64);
    const s = rsaEncrypt(orgKey, publicKey);
    expect(s.startsWith('4.')).toBe(true);
    expect(rsaDecrypt(s, privateKey).equals(orgKey)).toBe(true);
  });

  it('wipe zera a chave', () => {
    const k = symKeyFrom(crypto.randomBytes(64));
    wipe(k);
    expect(k.enc.every((b) => b === 0) && k.mac!.every((b) => b === 0)).toBe(true);
  });
});

describe('chaves de conta nova', () => {
  it('chave do usuário protegida pela chave mestra; chave privada pela do usuário', async () => {
    const mk = await makeMasterKey('senha', 'a@b.c', { type: 0, iterations: 5000 });
    const k = makeAccountKeys(mk);
    const raw = decrypt(k.protectedUserKey, stretchMasterKey(mk));
    expect(raw.length).toBe(64);
    const priv = decrypt(k.encryptedPrivateKey, symKeyFrom(raw));
    expect(() => crypto.createPrivateKey({ key: priv, format: 'der', type: 'pkcs8' })).not.toThrow();
  });
});
