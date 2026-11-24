// Campo do código de verificação (2 etapas / app autenticador) na página: achar e preencher.
// Roda no preload da aba (isolado da página). Dois formatos comuns: um campo só
// (autocomplete="one-time-code", "código", "otp"…) ou uma caixinha por dígito.
import { visible } from './fill';

const OTP_HINT = /one-?time|otp|totp|2fa|mfa|two.?factor|verification|verifica|c[oó]digo|\bcode\b|token|authenticator|autenticador|passcode|security.?code|pin\b/i;
const NOT_OTP = /phone|telefone|celular|zip|cep|postal|captcha|promo|coupon|cupom|search|busca|card|cart[aã]o|cvv|cvc/i;
const TEXTUAL = new Set(['text', 'tel', 'number', '']);

export type OtpField = { kind: 'single'; input: HTMLInputElement; length: number | null } | { kind: 'split'; inputs: HTMLInputElement[] };

const hints = (i: HTMLInputElement) => `${i.name} ${i.id} ${i.autocomplete} ${i.placeholder} ${i.getAttribute('aria-label') ?? ''} ${i.className}`;

/** Caixinhas de um dígito lado a lado (4 a 8, no mesmo pai ou avô). */
function splitBoxes(doc: Document): HTMLInputElement[] | null {
  const ones = [...doc.querySelectorAll<HTMLInputElement>('input[maxlength="1"]')].filter((i) => TEXTUAL.has(i.type) && visible(i));
  if (ones.length < 4) return null;
  const groups = new Map<Element, HTMLInputElement[]>();
  for (const i of ones) {
    const g = i.parentElement?.childElementCount === 1 ? i.parentElement.parentElement : i.parentElement;
    if (!g) continue;
    groups.set(g, [...(groups.get(g) ?? []), i]);
  }
  for (const list of groups.values()) if (list.length >= 4 && list.length <= 8) return list;
  return null;
}

/**
 * Campo do código na página, ou null. Filtra primeiro pelo que é barato (tipo, nome, rótulo)
 * e só depois confere a visibilidade (estilo calculado), que custa caro em páginas grandes.
 */
export function findOtpField(doc: Document): OtpField | null {
  const explicit = [...doc.querySelectorAll<HTMLInputElement>('input[autocomplete="one-time-code"]')].find((i) => TEXTUAL.has(i.type) && visible(i));
  if (explicit) return { kind: 'single', input: explicit, length: explicit.maxLength > 0 ? explicit.maxLength : null };
  const split = splitBoxes(doc);
  if (split) return { kind: 'split', inputs: split };
  const hinted = [...doc.querySelectorAll<HTMLInputElement>('input')].filter((i) => TEXTUAL.has(i.type) && i.maxLength !== 1
    && (i.maxLength <= 0 || (i.maxLength >= 4 && i.maxLength <= 10)) && OTP_HINT.test(hints(i)) && !NOT_OTP.test(hints(i)));
  if (!hinted.length) return null;
  const shown = hinted.filter(visible);
  if (shown.length !== 1) return null; // ambíguo: melhor não preencher nada
  // Com senha visível na tela é um login comum, não a etapa do código.
  if ([...doc.querySelectorAll<HTMLInputElement>('input[type=password]')].some(visible)) return null;
  const input = shown[0];
  return { kind: 'single', input, length: input.maxLength > 0 ? input.maxLength : null };
}

function setValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  el.focus();
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Preenche o código (só dígitos/letras do código). Devolve se achou onde. */
export function fillOtp(doc: Document, code: string): boolean {
  if (!/^[0-9A-Za-z]{4,10}$/.test(code)) return false;
  const f = findOtpField(doc);
  if (!f) return false;
  if (f.kind === 'single') { setValue(f.input, code); return true; }
  if (f.inputs.length !== code.length) return false;
  f.inputs.forEach((i, n) => setValue(i, code[n]));
  return true;
}

/** Avisa (uma vez por campo) quando um campo de código aparece na página. */
export function watchOtpField(doc: Document, onField: () => void): () => void {
  let seen: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    timer = null;
    const f = findOtpField(doc);
    const el = f ? (f.kind === 'single' ? f.input : f.inputs[0]) : null;
    if (el && el !== seen) { seen = el; onField(); }
  };
  const schedule = () => { if (!timer) timer = setTimeout(check, 400); };
  const mo = new MutationObserver(schedule);
  mo.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  schedule();
  return () => { mo.disconnect(); if (timer) clearTimeout(timer); };
}
