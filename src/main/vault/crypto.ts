// Criptografia do Bitwarden (mesmo esquema dos clientes oficiais):
//   chave mestra  = PBKDF2-SHA256(senha, e-mail) ou Argon2id(senha, SHA256(e-mail))
//   hash p/ login = PBKDF2-SHA256(chave mestra, senha, 1 iteração)
//   chave esticada = HKDF-Expand(chave mestra, "enc") ‖ HKDF-Expand(chave mestra, "mac")
//   EncString "2.iv|dados|mac" = AES-256-CBC + HMAC-SHA256(iv‖dados)
//   "4.dados" / "3.dados" = RSA-OAEP (SHA-1 / SHA-256), para chaves de organização
// A senha mestra nunca sai do computador: o servidor só recebe o hash.
import crypto from 'node:crypto';
import { argon2id } from 'hash-wasm';

export type Kdf =
  | { type: 0; iterations: number }
  | { type: 1; iterations: number; memory: number; parallelism: number };

/** Chave simétrica: 32 bytes para cifrar + 32 para autenticar. */
export interface SymKey {
  enc: Buffer;
  mac: Buffer | null;
}

export class VaultCryptoError extends Error {}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function makeMasterKey(password: string, email: string, kdf: Kdf): Promise<Buffer> {
  const salt = normalizeEmail(email);
  if (kdf.type === 0) {
    if (kdf.iterations < 5000) throw new VaultCryptoError('KDF fraco demais (PBKDF2 < 5000 iterações)');
    return new Promise((resolve, reject) =>
      crypto.pbkdf2(password, salt, kdf.iterations, 32, 'sha256', (err, key) => (err ? reject(err) : resolve(key))));
  }
  if (kdf.iterations < 2 || kdf.memory < 15 || kdf.parallelism < 1) throw new VaultCryptoError('parâmetros Argon2id fracos demais');
  const hex = await argon2id({
    password,
    salt: crypto.createHash('sha256').update(salt).digest(),
    iterations: kdf.iterations,
    memorySize: kdf.memory * 1024, // MiB → KiB
    parallelism: kdf.parallelism,
    hashLength: 32,
    outputType: 'hex',
  });
  return Buffer.from(hex, 'hex');
}

/** Hash enviado ao servidor no login (a senha em si nunca é enviada). */
export function hashMasterPassword(masterKey: Buffer, password: string): string {
  return crypto.pbkdf2Sync(masterKey, Buffer.from(password, 'utf8'), 1, 32, 'sha256').toString('base64');
}

/** HKDF-Expand (RFC 5869) sem a etapa Extract — é o que o Bitwarden usa. */
export function hkdfExpand(prk: Buffer, info: string | Buffer, length: number): Buffer {
  const infoBuf = typeof info === 'string' ? Buffer.from(info, 'utf8') : info;
  const blocks: Buffer[] = [];
  let prev = Buffer.alloc(0);
  for (let i = 1; Buffer.concat(blocks).length < length; i++) {
    prev = crypto.createHmac('sha256', prk).update(Buffer.concat([prev, infoBuf, Buffer.from([i])])).digest();
    blocks.push(prev);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

export function stretchMasterKey(masterKey: Buffer): SymKey {
  return { enc: hkdfExpand(masterKey, 'enc', 32), mac: hkdfExpand(masterKey, 'mac', 32) };
}

/** Chave de 64 bytes (cifra ‖ MAC) ou 32 (antiga, sem MAC). */
export function symKeyFrom(raw: Buffer): SymKey {
  if (raw.length === 64) return { enc: Buffer.from(raw.subarray(0, 32)), mac: Buffer.from(raw.subarray(32)) };
  if (raw.length === 32) return { enc: Buffer.from(raw), mac: null };
  throw new VaultCryptoError(`chave com tamanho inesperado (${raw.length})`);
}

/** Apaga a chave da memória (Buffers podem ser zerados; strings não). */
export function wipe(key: SymKey | Buffer | null | undefined): void {
  if (!key) return;
  if (Buffer.isBuffer(key)) { key.fill(0); return; }
  key.enc.fill(0);
  key.mac?.fill(0);
}

// ------------------------------------------------------------ EncString

export interface EncString {
  type: number;
  iv?: Buffer;
  data: Buffer;
  mac?: Buffer;
}

export function parseEncString(s: string): EncString {
  const dot = s.indexOf('.');
  if (dot < 1) throw new VaultCryptoError('EncString sem tipo');
  const type = Number(s.slice(0, dot));
  const parts = s.slice(dot + 1).split('|').map((p) => Buffer.from(p, 'base64'));
  switch (type) {
    case 0: if (parts.length === 2) return { type, iv: parts[0], data: parts[1] }; break;
    case 2: if (parts.length === 3) return { type, iv: parts[0], data: parts[1], mac: parts[2] }; break;
    case 3: case 4: if (parts.length === 1) return { type, data: parts[0] }; break;
    case 5: case 6: if (parts.length === 2) return { type, data: parts[0], mac: parts[1] }; break;
  }
  throw new VaultCryptoError(`EncString inválida (tipo ${type})`);
}

export function decrypt(s: string, key: SymKey): Buffer {
  const e = parseEncString(s);
  if (e.type === 2) {
    if (!key.mac) throw new VaultCryptoError('chave sem MAC para EncString autenticada');
    const mac = crypto.createHmac('sha256', key.mac).update(Buffer.concat([e.iv!, e.data])).digest();
    if (mac.length !== e.mac!.length || !crypto.timingSafeEqual(mac, e.mac!)) {
      throw new VaultCryptoError('MAC inválido (chave errada ou dado adulterado)');
    }
  } else if (e.type !== 0) {
    throw new VaultCryptoError(`tipo de EncString não simétrico: ${e.type}`);
  }
  try {
    const d = crypto.createDecipheriv('aes-256-cbc', key.enc, e.iv!);
    return Buffer.concat([d.update(e.data), d.final()]);
  } catch {
    throw new VaultCryptoError('falha ao decifrar');
  }
}

export const decryptString = (s: string, key: SymKey): string => decrypt(s, key).toString('utf8');

export function encrypt(plain: Buffer | string, key: SymKey): string {
  if (!key.mac) throw new VaultCryptoError('cifrar exige chave com MAC');
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', key.enc, iv);
  const data = Buffer.concat([c.update(typeof plain === 'string' ? Buffer.from(plain, 'utf8') : plain), c.final()]);
  const mac = crypto.createHmac('sha256', key.mac).update(Buffer.concat([iv, data])).digest();
  return `2.${iv.toString('base64')}|${data.toString('base64')}|${mac.toString('base64')}`;
}

/** RSA-OAEP com a chave privada do usuário (PKCS#8 DER): chaves de organização. */
export function rsaDecrypt(s: string, privateKeyDer: Buffer): Buffer {
  const e = parseEncString(s);
  const oaepHash = e.type === 3 || e.type === 5 ? 'sha256' : e.type === 4 || e.type === 6 ? 'sha1' : null;
  if (!oaepHash) throw new VaultCryptoError(`tipo de EncString não RSA: ${e.type}`);
  try {
    const key = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
    return crypto.privateDecrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash }, e.data);
  } catch {
    throw new VaultCryptoError('falha ao decifrar com RSA');
  }
}

export function rsaEncrypt(plain: Buffer, publicKeyDer: Buffer): string {
  const key = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
  const data = crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, plain);
  return `4.${data.toString('base64')}`;
}

// ------------------------------------------------------------ criação de conta (testes de compatibilidade)

export interface NewAccountKeys {
  userKey: SymKey;
  /** Chave do usuário cifrada com a chave mestra esticada. */
  protectedUserKey: string;
  publicKey: string;
  encryptedPrivateKey: string;
}

export function makeAccountKeys(masterKey: Buffer): NewAccountKeys {
  const raw = crypto.randomBytes(64);
  const userKey = symKeyFrom(raw);
  const protectedUserKey = encrypt(raw, stretchMasterKey(masterKey));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return { userKey, protectedUserKey, publicKey: publicKey.toString('base64'), encryptedPrivateKey: encrypt(privateKey, userKey) };
}
