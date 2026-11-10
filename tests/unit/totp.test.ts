import { describe, expect, it } from 'vitest';
import { base32Decode, parseTotp, totp } from '../../src/main/vault/totp';

// RFC 6238, apêndice B (8 dígitos). Segredos ASCII de 20/32/64 bytes.
const RFC = {
  sha1: Buffer.from('12345678901234567890'),
  sha256: Buffer.from('12345678901234567890123456789012'),
  sha512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
};

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1234567890, '89005924', '91819424', '93441116'],
    [20000000000, '65353130', '77737706', '47863826'],
  ])('t=%i', (t, s1, s256, s512) => {
    const at = t * 1000;
    expect(totp({ secret: RFC.sha1, digits: 8, period: 30, algorithm: 'sha1' }, at).code).toBe(s1);
    expect(totp({ secret: RFC.sha256, digits: 8, period: 30, algorithm: 'sha256' }, at).code).toBe(s256);
    expect(totp({ secret: RFC.sha512, digits: 8, period: 30, algorithm: 'sha512' }, at).code).toBe(s512);
  });

  it('segundos restantes no período', () => {
    expect(totp(parseTotp('JBSWY3DPEHPK3PXP'), 61_000).remaining).toBe(29);
  });
});

describe('parseTotp', () => {
  it('segredo base32 puro (com espaços/minúsculas)', () => {
    expect(base32Decode('jbsw y3dp ehpk 3pxp').toString('hex')).toBe('48656c6c6f21deadbeef'); // "Hello!" + DEADBEEF
    expect(parseTotp('JBSWY3DPEHPK3PXP')).toMatchObject({ digits: 6, period: 30, algorithm: 'sha1' });
  });

  it('otpauth:// com parâmetros', () => {
    expect(parseTotp('otpauth://totp/Empresa:eu?secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=SHA256'))
      .toMatchObject({ digits: 8, period: 60, algorithm: 'sha256' });
  });

  it('recusa o que não sabe gerar', () => {
    expect(() => parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP')).toThrow();
    expect(() => parseTotp('steam://ABC')).toThrow();
    expect(() => parseTotp('não é base32!')).toThrow();
  });
});
