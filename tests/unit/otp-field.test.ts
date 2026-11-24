// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fillOtp, findOtpField } from '../../src/preload/otp';

const html = (s: string) => { document.body.innerHTML = s; };
const val = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;
beforeEach(() => { document.body.innerHTML = ''; });

describe('campo do código de verificação', () => {
  it('autocomplete="one-time-code" (o padrão)', () => {
    html(`<input name="q"><input id="c" autocomplete="one-time-code" inputmode="numeric" maxlength="6">`);
    expect(fillOtp(document, '123456')).toBe(true);
    expect(val('#c')).toBe('123456');
    expect(val('input[name=q]')).toBe('');
  });

  it('pelo nome/rótulo ("código", "otp", "2fa"), em português e inglês', () => {
    for (const attrs of ['name="otp"', 'placeholder="Código de verificação"', 'id="totpPin"', 'aria-label="Enter the 6-digit code"', 'name="mfa_code" maxlength="6"']) {
      html(`<form><input type="text" ${attrs}><button>Verificar</button></form>`);
      expect(findOtpField(document), attrs).not.toBeNull();
    }
  });

  it('caixinhas de um dígito: um dígito em cada', () => {
    html(`<div class="otp">${Array.from({ length: 6 }, (_, i) => `<input id="d${i}" maxlength="1" inputmode="numeric">`).join('')}</div>`);
    expect(findOtpField(document)?.kind).toBe('split');
    expect(fillOtp(document, '987654')).toBe(true);
    expect([0, 1, 2, 3, 4, 5].map((i) => val(`#d${i}`)).join('')).toBe('987654');
    expect(fillOtp(document, '1234')).toBe(false); // tamanho diferente: não arrisca
  });

  it('não confunde: telefone, CEP, cartão, tela de login com senha, dois candidatos', () => {
    html(`<input name="phone_code" placeholder="código do país"><input name="cep">`);
    expect(findOtpField(document)).toBeNull();
    html(`<input name="username"><input type="password"><input name="code" placeholder="código promocional">`);
    expect(findOtpField(document)).toBeNull();
    html(`<input name="otp1" placeholder="código"><input name="otp2" placeholder="código de backup">`);
    expect(findOtpField(document)).toBeNull();
    expect(fillOtp(document, 'abc')).toBe(false); // código inválido
  });
});
