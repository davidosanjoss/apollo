// Criptografia do arquivo sincronizado: tudo é cifrado AQUI, com a senha de sincronização
// do usuário, antes de ir para a nuvem (o Google/a Microsoft só guardam bytes ilegíveis).
// scrypt (chave) + AES-256-GCM (conteúdo, autenticado) + gzip.
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAGIC = 'apollo-sync';

interface Envelope { [MAGIC]: 1; salt: string; iv: string; tag: string; data: string }

const keyCache = new Map<string, Buffer>();

export async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  const id = `${salt.toString('base64')}:${passphrase}`;
  const cached = keyCache.get(id);
  if (cached) return cached;
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(passphrase.normalize('NFC'), salt, 32, SCRYPT, (err, k) => (err ? reject(err) : resolve(k))));
  keyCache.clear(); // só a chave atual em memória
  keyCache.set(id, key);
  return key;
}

/** Cifra; `salt` do arquivo que já existe na nuvem (para os outros computadores abrirem). */
export async function seal(value: unknown, passphrase: string, salt: Buffer = randomBytes(16)): Promise<Buffer> {
  const key = await deriveKey(passphrase, salt);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(value)))), c.final()]);
  const env: Envelope = { [MAGIC]: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
  return Buffer.from(JSON.stringify(env));
}

export class WrongPassphrase extends Error {
  constructor() { super('A senha de sincronização não confere com a usada nos outros computadores.'); }
}

export function envelopeSalt(bytes: Buffer): Buffer {
  const env = JSON.parse(bytes.toString('utf8')) as Envelope;
  if (env[MAGIC] !== 1) throw new Error('arquivo de sincronização desconhecido');
  return Buffer.from(env.salt, 'base64');
}

export async function open(bytes: Buffer, passphrase: string): Promise<unknown> {
  const env = JSON.parse(bytes.toString('utf8')) as Envelope;
  if (env[MAGIC] !== 1) throw new Error('arquivo de sincronização desconhecido');
  const key = await deriveKey(passphrase, Buffer.from(env.salt, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  d.setAuthTag(Buffer.from(env.tag, 'base64'));
  let plain: Buffer;
  try {
    plain = Buffer.concat([d.update(Buffer.from(env.data, 'base64')), d.final()]);
  } catch {
    throw new WrongPassphrase(); // GCM: senha errada (ou arquivo adulterado) não abre
  }
  return JSON.parse(gunzipSync(plain).toString('utf8'));
}
