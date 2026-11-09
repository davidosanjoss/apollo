// Bloqueio de anúncios e rastreadores na rede (motor do Ghostery), como módulo do
// pipeline de rede. Dois motores independentes = dois interruptores independentes.
import { FiltersEngine, Request } from '@ghostery/adblocker';
import type { OnBeforeRequestListenerDetails } from 'electron';
import type { PrivacyToggles } from '../../shared/types';
import type { NetworkModule, RequestContext } from '../network';

export type BlockKind = 'ads' | 'trackers';

export interface Engines {
  ads: FiltersEngine;
  tracking: FiltersEngine;
}

type GhosteryType = Parameters<typeof Request.fromRawDetails>[0]['type'];

const TYPES: Record<string, GhosteryType> = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
};

export const requestType = (electronType: string): GhosteryType => TYPES[electronType] ?? 'other';

export interface BlockDecision {
  kind: BlockKind;
  /** Recurso "neutro" no lugar (ex.: script vazio), para a página não quebrar. */
  redirectURL?: string;
}

export class Blocker {
  constructor(private engines: Engines) {}

  setEngines(engines: Engines): void {
    this.engines = engines;
  }

  check(url: string, electronType: string, sourceUrl: string | null, toggles: PrivacyToggles): BlockDecision | null {
    // Navegação principal nunca é bloqueada aqui (o usuário pediu a página).
    if (electronType === 'mainFrame' || !/^(https?|wss?):/i.test(url)) return null;
    const request = Request.fromRawDetails({ url, type: requestType(electronType), sourceUrl: sourceUrl ?? undefined });
    for (const [kind, engine, on] of [['ads', this.engines.ads, toggles.ads], ['trackers', this.engines.tracking, toggles.trackers]] as const) {
      if (!on) continue;
      const { match, redirect } = engine.match(request);
      if (redirect) return { kind, redirectURL: redirect.dataUrl };
      if (match) return { kind };
    }
    return null;
  }
}

export interface BlockerHooks {
  /** Interruptores para a requisição (camadas resolvidas pelo Browser). */
  togglesFor(ctx: RequestContext, sourceUrl: string | null): PrivacyToggles;
  onBlocked(ctx: RequestContext, kind: BlockKind): void;
}

export function blockerModule(blocker: Blocker, hooks: BlockerHooks): NetworkModule {
  return {
    name: 'blocker',
    onBeforeRequest(details: OnBeforeRequestListenerDetails, ctx) {
      // Primeira parte = página da aba; sem aba (service worker), quem pediu.
      const sourceUrl = ctx.tabUrl ?? details.referrer ?? details.frame?.url ?? null;
      const decision = blocker.check(details.url, details.resourceType, sourceUrl || null, hooks.togglesFor(ctx, sourceUrl || null));
      if (!decision) return undefined;
      hooks.onBlocked(ctx, decision.kind);
      return decision.redirectURL ? { redirectURL: decision.redirectURL } : { cancel: true };
    },
  };
}

export const emptyEngine = (): FiltersEngine => FiltersEngine.empty();
