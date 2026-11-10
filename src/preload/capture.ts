// Percebe quando o usuário envia um login, para oferecer salvar no Bitwarden.
// Só lê valores que o próprio usuário digitou; quem decide salvar é ele (barra no Apollo).
import { findUsername, visible } from './fill';

export interface Captured { username: string | null; password: string }

const MAX = 1024;

/** Senha (e usuário) do formulário de login visível, se houver senha digitada. */
export function captureLogin(doc: Document): Captured | null {
  const pass = [...doc.querySelectorAll<HTMLInputElement>('input[type=password]')].find((i) => visible(i) && i.value) ?? null;
  if (!pass || pass.value.length > MAX) return null;
  const user = findUsername(pass.form ?? doc, pass) ?? (pass.form ? findUsername(doc, pass) : null);
  const username = user?.value.trim() || null;
  return { username: username && username.length <= MAX ? username : null, password: pass.value };
}

/** Primeira etapa de login em duas etapas (só e-mail/usuário na tela). */
export function captureUsernameStep(doc: Document): string | null {
  if ([...doc.querySelectorAll<HTMLInputElement>('input[type=password]')].some(visible)) return null;
  const v = findUsername(doc)?.value.trim();
  return v && v.length <= MAX ? v : null;
}

const SUBMIT_LIKE = 'button, input[type=submit], input[type=button], [role=button]';

export function watchLogins(doc: Document, onLogin: (c: Captured) => void, onUsername: (u: string) => void): void {
  let last = '';
  let lastAt = 0;
  const check = () => {
    const c = captureLogin(doc);
    if (c) {
      const key = `${c.username}\\u0000${c.password}`;
      if (key === last && Date.now() - lastAt < 3000) return; // clique + submit do mesmo envio
      last = key;
      lastAt = Date.now();
      onLogin(c);
      return;
    }
    const u = captureUsernameStep(doc);
    if (u) onUsername(u);
  };
  doc.addEventListener('submit', check, true);
  doc.addEventListener('click', (e) => {
    if ((e.target as Element | null)?.closest?.(SUBMIT_LIKE)) check();
  }, true);
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as Element | null)?.matches?.('input')) check();
  }, true);
}
