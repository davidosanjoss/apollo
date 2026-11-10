// Preenchimento de login na página (roda no preload da aba, isolado da página).
// Separado do preload para ser testável com um DOM simulado.

const USERNAME_HINT = /user|usuario|login|e-?mail|mail|conta|account|cpf|matr[ií]cula|identifier|loginfmt/i;

export function visible(el: HTMLInputElement): boolean {
  if (el.disabled || el.readOnly || el.type === 'hidden' || el.hidden) return false;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const st = n.ownerDocument.defaultView?.getComputedStyle(n);
    if (n.hidden || st?.display === 'none' || st?.visibility === 'hidden') return false;
  }
  return true;
}

/** Define o valor como o usuário faria (frameworks como React escutam esses eventos). */
function setValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  el.focus();
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const TEXTUAL = new Set(['text', 'email', 'tel', '']);

export function findUsername(scope: ParentNode, before?: Element): HTMLInputElement | null {
  const inputs = [...scope.querySelectorAll('input')].filter((i) => TEXTUAL.has(i.type) && visible(i));
  const candidates = before ? inputs.filter((i) => before.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_PRECEDING) : inputs;
  const hinted = candidates.filter((i) => i.autocomplete === 'username' || i.type === 'email'
    || USERNAME_HINT.test(`${i.name} ${i.id} ${i.autocomplete} ${i.placeholder}`));
  // O mais próximo antes da senha; sem senha, o primeiro com cara de usuário.
  return (before ? (hinted.at(-1) ?? candidates.at(-1)) : (hinted[0] ?? null)) ?? null;
}

export interface FillResult { username: boolean; password: boolean }

export function fillLogin(doc: Document, username: string | null, password: string | null): FillResult {
  const result = { username: false, password: false };
  const pass = [...doc.querySelectorAll<HTMLInputElement>('input[type=password]')].find(visible) ?? null;
  const scope: ParentNode = pass?.form ?? doc;
  const user = findUsername(scope, pass ?? undefined) ?? (pass ? findUsername(doc, pass) : null);
  if (user && username) { setValue(user, username); result.username = true; }
  if (pass && password) { setValue(pass, password); result.password = true; }
  return result;
}

/** Gerador: preenche os campos de senha VAZIOS e visíveis (senha nova + confirmação). */
export function fillNewPassword(doc: Document, password: string): number {
  const fields = [...doc.querySelectorAll<HTMLInputElement>('input[type=password]')].filter((i) => visible(i) && !i.value);
  for (const f of fields) setValue(f, password);
  return fields.length;
}
