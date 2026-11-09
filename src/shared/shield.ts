import type { SitePermissions, SitePrivacy } from './types';

/** Estado do escudo da barra de endereço (anúncios + rastreadores): todo ligado, parcial ou desligado. */
export function shieldState(p: SitePrivacy): 'on' | 'partial' | 'off' {
  if (p.tabPaused) return 'off';
  const on = [p.toggles.ads, p.toggles.trackers].filter(Boolean).length;
  return on === 2 ? 'on' : on === 0 ? 'off' : 'partial';
}

/** A engrenagem fica destacada quando o site tem alguma permissão definida pelo usuário. */
export const hasCustomPermissions = (info: SitePermissions): boolean => info.entries.some((e) => e.decision !== null);
