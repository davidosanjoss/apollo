// Regras de privacidade em camadas, da menos para a mais específica:
//   global → workspace → site (no workspace) → aba (temporária, até fechar)
// A camada mais específica que definir um interruptor vence.
import { getDomain } from 'tldts';
import type { PrivacyFeature, PrivacyLevel, PrivacyToggles } from '../../shared/types';

export type Overrides = Partial<PrivacyToggles>;

export const DEFAULT_TOGGLES: PrivacyToggles = { ads: true, trackers: true };

export interface Layers {
  global: Overrides;
  workspace: Overrides;
  site: Overrides;
  tab: Overrides;
}

export interface Resolved {
  toggles: PrivacyToggles;
  /** De qual camada veio cada interruptor (para o painel explicar). */
  source: Record<PrivacyFeature, PrivacyLevel>;
}

const ORDER: (keyof Layers)[] = ['tab', 'site', 'workspace', 'global'];

export function resolve(layers: Layers): Resolved {
  const toggles = {} as PrivacyToggles;
  const source = {} as Record<PrivacyFeature, PrivacyLevel>;
  for (const f of Object.keys(DEFAULT_TOGGLES) as PrivacyFeature[]) {
    const level = ORDER.find((l) => typeof layers[l][f] === 'boolean');
    toggles[f] = level ? layers[level][f]! : DEFAULT_TOGGLES[f];
    source[f] = level ?? 'default';
  }
  return { toggles, source };
}

/**
 * "Site" = domínio registrável (eTLD+1): outlook.office.com → office.com,
 * a.b.gov.br → b.gov.br. Endereços IP e localhost valem por si.
 */
export function siteOf(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    host = u.hostname;
  } catch {
    return null;
  }
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}
