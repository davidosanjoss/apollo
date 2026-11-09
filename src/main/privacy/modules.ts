// Módulos do pipeline de rede: cookies de terceiros e limpeza de URL.
import type { PrivacyToggles } from '../../shared/types';
import type { Headers, NetworkModule, RequestContext } from '../network';
import { isThirdParty } from './third-party';
import { cleanUrl } from './url-cleaning';

export type TogglesFor = (ctx: RequestContext, firstPartyUrl: string | null) => PrivacyToggles;

/** Página de origem de uma subrequisição (sem aba: quem pediu). */
const firstPartyOf = (ctx: RequestContext, referrer: string | undefined, frameUrl: string | undefined) =>
  ctx.tabUrl ?? (referrer || frameUrl || null);

/**
 * Cookies de terceiros: não envia (Cookie) nem aceita (Set-Cookie) em requisições
 * para outro site/empresa. A navegação principal nunca é terceira.
 */
export function thirdPartyCookiesModule(togglesFor: TogglesFor): NetworkModule {
  const blocks = (url: string, type: string, ctx: RequestContext, first: string | null) =>
    type !== 'mainFrame' && isThirdParty(url, first) && togglesFor(ctx, first).thirdPartyCookies;
  return {
    name: 'third-party-cookies',
    onBeforeSendHeaders(details, headers, ctx) {
      const first = firstPartyOf(ctx, details.referrer, details.frame?.url);
      if (!blocks(details.url, details.resourceType, ctx, first)) return;
      for (const k of Object.keys(headers)) if (k.toLowerCase() === 'cookie') delete headers[k];
    },
    onHeadersReceived(details, headers: Headers, ctx) {
      const first = firstPartyOf(ctx, details.referrer, details.frame?.url);
      if (!blocks(details.url, details.resourceType, ctx, first)) return;
      for (const k of Object.keys(headers)) if (k.toLowerCase() === 'set-cookie') delete headers[k];
    },
  };
}

/** Limpeza de URL: redireciona a navegação principal para a URL sem rastreio. */
export function urlCleaningModule(togglesFor: TogglesFor): NetworkModule {
  return {
    name: 'url-cleaning',
    onBeforeRequest(details, ctx) {
      if (details.resourceType !== 'mainFrame' || details.method !== 'GET') return undefined;
      const clean = cleanUrl(details.url);
      // A regra é a do site de DESTINO (é para lá que o usuário vai).
      if (!clean || !togglesFor(ctx, details.url).urlCleaning) return undefined;
      return { redirectURL: clean };
    },
  };
}
