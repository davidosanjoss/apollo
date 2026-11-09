// Menu do escudo na barra de endereço: proteção do domínio atual, sobrescrevendo
// o padrão. Modelo puro (testável); o Browser transforma em menu nativo.
import type { PrivacyFeature, SitePrivacy, UiCommand } from '../../shared/types';

export type PrivacyMenuItem =
  | { kind: 'info'; label: string }
  | { kind: 'separator' }
  | { kind: 'check'; label: string; checked: boolean; enabled: boolean; command: UiCommand }
  | { kind: 'action'; label: string; enabled: boolean; command: UiCommand };

const QUICK: [PrivacyFeature, string][] = [
  ['ads', 'Bloquear anúncios'],
  ['trackers', 'Bloquear rastreadores'],
];

export function privacyMenu(p: SitePrivacy): PrivacyMenuItem[] {
  const { ads, trackers } = p.blocked;
  const hasOverride = QUICK.some(([f]) => p.siteRules[f] !== null);
  return [
    { kind: 'info', label: `Proteção em ${p.site}` },
    { kind: 'info', label: p.tabPaused ? 'Pausada nesta aba' : `Nesta página: ${ads} anúncios e ${trackers} rastreadores bloqueados` },
    { kind: 'separator' },
    // Marcar/desmarcar grava uma regra do domínio (neste workspace) com o valor oposto ao atual.
    ...QUICK.map(([feature, label]): PrivacyMenuItem => ({
      kind: 'check',
      label: p.siteRules[feature] === null ? label : `${label} (neste site)`,
      checked: p.toggles[feature],
      enabled: !p.tabPaused,
      command: { type: 'privacy:set', scope: 'site', feature, enabled: !p.toggles[feature] },
    })),
    { kind: 'separator' },
    { kind: 'action', label: 'Usar o padrão neste site', enabled: hasOverride, command: { type: 'privacy:reset-site' } },
    { kind: 'check', label: 'Pausar proteção nesta aba', checked: p.tabPaused, enabled: true,
      command: { type: 'privacy:pause-tab', paused: !p.tabPaused } },
  ];
}
