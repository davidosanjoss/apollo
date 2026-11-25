import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { bgraToRgba, describeOtpauth, normalizeSecret, otpauthFromImage } from '../../src/main/vault/totp-setup';

/** QR code desenhado em pixels RGBA (como na captura da página), com margem branca e escala. */
function qrImage(text: string, scale = 4, pad = 40) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const size = n * scale + pad * 2;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!qr.modules.get(y, x)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = ((pad + y * scale + dy) * size + pad + x * scale + dx) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }
  return { px, size };
}

const URI = 'otpauth://totp/GitHub:eu%40teste.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub';

describe('cadastrar app autenticador', () => {
  it('lê o QR code de autenticador da imagem da página', () => {
    const { px, size } = qrImage(URI);
    expect(otpauthFromImage(px, size, size)).toBe(URI);
  });

  it('QR que não é de autenticador (link comum, HOTP) é ignorado', () => {
    for (const t of ['https://exemplo.com', 'otpauth://hotp/X?secret=JBSWY3DPEHPK3PXP&counter=1', 'otpauth://totp/X?secret=!!']) {
      const { px, size } = qrImage(t);
      expect(otpauthFromImage(px, size, size), t).toBeNull();
    }
    const blank = new Uint8ClampedArray(100 * 100 * 4).fill(255);
    expect(otpauthFromImage(blank, 100, 100)).toBeNull();
  });

  it('captura do Electron (BGRA) vira RGBA', () => {
    expect([...bgraToRgba(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))]).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
  });

  it('emissor e conta do endereço', () => {
    expect(describeOtpauth(URI)).toEqual({ issuer: 'GitHub', account: 'eu@teste.com' });
    expect(describeOtpauth('otpauth://totp/eu@x.com?secret=JBSWY3DPEHPK3PXP')).toEqual({ issuer: null, account: 'eu@x.com' });
    expect(describeOtpauth('otpauth://totp/Banco:conta%201?secret=JBSWY3DPEHPK3PXP')).toEqual({ issuer: 'Banco', account: 'conta 1' });
  });

  it('chave colada: base32 com espaços (como os sites mostram) ou otpauth; o resto não', () => {
    expect(normalizeSecret('jbsw y3dp ehpk 3pxp')).toBe('JBSWY3DPEHPK3PXP');
    expect(normalizeSecret(URI)).toBe(URI);
    expect(normalizeSecret('123456')).toBeNull(); // é um código, não a chave
    expect(normalizeSecret('JBSWY3DP')).toBeNull(); // curta demais
    expect(normalizeSecret('olá mundo isso não é chave')).toBeNull();
  });
});
