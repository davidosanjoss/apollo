// Cadastrar o app autenticador de um site no Bitwarden: o site mostra um QR code com um
// endereço otpauth://totp/… (ou a chave em texto, "não consegue ler o código?"). O Apollo
// lê o QR da própria página (captura da aba), confere e guarda no login do site.
import jsQR from 'jsqr';
import { parseTotp } from './totp';

/** Pixels BGRA (nativeImage.toBitmap) → RGBA (o que o leitor de QR espera). */
export function bgraToRgba(bgra: Buffer): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    out[i] = bgra[i + 2];
    out[i + 1] = bgra[i + 1];
    out[i + 2] = bgra[i];
    out[i + 3] = bgra[i + 3];
  }
  return out;
}

/** QR code de autenticador na imagem (RGBA), ou null. */
export function otpauthFromImage(rgba: Uint8ClampedArray, width: number, height: number): string | null {
  const qr = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  const data = qr?.data?.trim();
  return data && isTotpUri(data) ? data : null;
}

const isTotpUri = (v: string) => {
  if (!/^otpauth:\/\/totp\//i.test(v)) return false;
  try { parseTotp(v); return true; } catch { return false; }
};

/** Emissor e conta do otpauth ("otpauth://totp/GitHub:eu@x.com?issuer=GitHub&secret=…"). */
export function describeOtpauth(uri: string): { issuer: string | null; account: string | null } {
  try {
    const u = new URL(uri);
    const label = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    const [a, b] = label.includes(':') ? label.split(/:(.*)/s) : [null, label];
    const issuer = u.searchParams.get('issuer') || a || null;
    return { issuer: issuer?.trim() || null, account: (b ?? '').trim() || null };
  } catch {
    return { issuer: null, account: null };
  }
}

/**
 * Chave colada pelo usuário: otpauth://… ou a chave em base32 (com espaços/hífens, como os
 * sites mostram). Devolve o que guardar no Bitwarden, ou null se não for uma chave válida.
 */
export function normalizeSecret(input: string): string | null {
  const v = input.trim();
  if (/^otpauth:\/\//i.test(v)) return isTotpUri(v) ? v : null;
  const clean = v.toUpperCase().replace(/[\s-]/g, '');
  if (clean.length < 16 || !/^[A-Z2-7]+=*$/.test(clean)) return null; // chave TOTP tem ao menos 80 bits
  try { parseTotp(clean); return clean; } catch { return null; }
}
