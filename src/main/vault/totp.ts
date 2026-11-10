// Códigos de verificação (TOTP, RFC 6238), como o Bitwarden Premium gera.
import crypto from 'node:crypto';

export interface TotpParams { secret: Buffer; digits: number; period: number; algorithm: 'sha1' | 'sha256' | 'sha512' }

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('segredo TOTP inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Aceita o segredo puro (base32) ou um otpauth://totp/…?secret=…&digits=…&period=…&algorithm=… */
export function parseTotp(value: string): TotpParams {
  const v = value.trim();
  if (/^otpauth:\/\//i.test(v)) {
    const u = new URL(v);
    if (u.host.toLowerCase() !== 'totp') throw new Error('só TOTP é suportado');
    const algo = (u.searchParams.get('algorithm') ?? 'SHA1').toLowerCase();
    const digits = Number(u.searchParams.get('digits') ?? 6);
    const period = Number(u.searchParams.get('period') ?? 30);
    if (!['sha1', 'sha256', 'sha512'].includes(algo) || !(digits >= 6 && digits <= 10) || !(period >= 1 && period <= 300)) {
      throw new Error('parâmetros TOTP inválidos');
    }
    return { secret: base32Decode(u.searchParams.get('secret') ?? ''), digits, period, algorithm: algo as TotpParams['algorithm'] };
  }
  if (/^steam:\/\//i.test(v)) throw new Error('códigos Steam não são suportados');
  return { secret: base32Decode(v), digits: 6, period: 30, algorithm: 'sha1' };
}

export function totp(p: TotpParams, now = Date.now()): { code: string; remaining: number } {
  const counter = Math.floor(now / 1000 / p.period);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(p.algorithm, p.secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  const code = String(bin % 10 ** p.digits).padStart(p.digits, '0');
  return { code, remaining: p.period - (Math.floor(now / 1000) % p.period) };
}
