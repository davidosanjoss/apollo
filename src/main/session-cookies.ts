import type { Cookie, CookiesSetDetails, Session } from 'electron';

/**
 * Cookies de sessão (sem data de validade) morrem quando o navegador fecha. Muitos
 * logins (Microsoft/Outlook, SSO de empresa e faculdade) dependem deles. Como
 * Chrome/Opera em "continuar de onde parou", o Apollo os salva ao fechar e os
 * devolve antes de a primeira aba do workspace carregar.
 *
 * Ficam cifrados com a chave do chaveiro do sistema (a mesma dos cookies normais).
 */

export interface StoredCookie {
  name: string;
  value: string;
  /** Só para cookies de domínio (".exemplo.com"); host-only não leva domínio. */
  domain?: string;
  host: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: CookiesSetDetails['sameSite'];
}

export type { SecretBox as Cipher } from './secret-box';
import type { SecretBox as Cipher } from './secret-box';

export function toStored(c: Cookie): StoredCookie | null {
  if (!c.session || !c.domain) return null;
  const host = c.domain.replace(/^\./, '');
  if (!host) return null;
  return {
    name: c.name,
    value: c.value,
    ...(c.hostOnly ? {} : { domain: c.domain }),
    host,
    path: c.path || '/',
    secure: Boolean(c.secure),
    httpOnly: Boolean(c.httpOnly),
    sameSite: c.sameSite,
  };
}

export function toSetDetails(c: StoredCookie): CookiesSetDetails {
  return {
    url: `${c.secure ? 'https' : 'http'}://${c.host}${c.path}`,
    name: c.name,
    value: c.value,
    ...(c.domain ? { domain: c.domain } : {}),
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    // Sem expirationDate: continua sendo cookie de sessão.
  };
}

export async function captureSessionCookies(ses: Session, cipher: Cipher): Promise<Buffer> {
  const cookies = (await ses.cookies.get({})).map(toStored).filter((c): c is StoredCookie => c !== null);
  return await cipher.encrypt(JSON.stringify(cookies));
}

/** Devolve os cookies à sessão. Erros (dado ilegível, cookie recusado) não impedem o resto. */
export async function restoreSessionCookies(ses: Session, data: Buffer, cipher: Cipher): Promise<number> {
  let cookies: StoredCookie[];
  try {
    cookies = JSON.parse(await cipher.decrypt(data));
    if (!Array.isArray(cookies)) return 0;
  } catch {
    return 0; // chave do chaveiro mudou ou dado corrompido: segue sem eles
  }
  const results = await Promise.allSettled(cookies.map((c) => ses.cookies.set(toSetDetails(c))));
  return results.filter((r) => r.status === 'fulfilled').length;
}
