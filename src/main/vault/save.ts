// Depois de um login enviado: oferecer salvar, atualizar ou nada.
import { loginsFor } from './match';
import type { VaultLogin } from './vault';

export type SaveDecision = { mode: 'save' } | { mode: 'update'; itemId: string } | null;

export function decideSave(logins: VaultLogin[], passwordOf: (id: string) => string | null, url: string,
  username: string | null, password: string, defaultMatch?: number): SaveDecision {
  const forSite = loginsFor(logins, url, defaultMatch);
  const sameUser = forSite.filter((l) => (l.username ?? '').toLowerCase() === (username ?? '').toLowerCase());
  if (sameUser.some((l) => passwordOf(l.id) === password)) return null; // já salvo assim
  if (sameUser.length) return { mode: 'update', itemId: sameUser[0].id };
  // Sem usuário (segunda etapa sem e-mail conhecido) e o site só tem um login: é a senha dele.
  if (!username && forSite.length === 1) {
    return passwordOf(forSite[0].id) === password ? null : { mode: 'update', itemId: forSite[0].id };
  }
  return { mode: 'save' };
}

/** Nome do item novo: o host sem "www." (como o Bitwarden faz). */
export const itemName = (url: string) => new URL(url).hostname.replace(/^www\./, '');
