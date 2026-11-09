// Menu do escudo na barra de endereço: proteção do domínio atual, sobrescrevendo
// o padrão. Modelo puro (testável); o Browser transforma em menu nativo.
import type { PrivacyFeature, SitePrivacy } from '../../shared/types';
import type { MenuModelItem } from '../menu-model';

const QUICK: [PrivacyFeature, string][] = [
  ['ads', 'Bloquear anúncios'],
  ['trackers', 'Bloquear rastreadores'],
];
const MORE: [PrivacyFeature, string][] = [
  ['thirdPartyCookies', 'Bloquear cookies de terceiros'],
  ['urlCleaning', 'Limpar rastreio dos links'],
];

export function privacyMenu(p: SitePrivacy): MenuModelItem[] {
  const { ads, trackers } = p.blocked;
  const hasOverride = [...QUICK, ...MORE].some(([f]) => p.siteRules[f] !== null);
  // Marcar/desmarcar grava uma regra do domínio (neste workspace) com o valor oposto ao atual.
  const toggle = ([feature, label]: [PrivacyFeature, string]): MenuModelItem => ({
    kind: 'check',
    label: p.siteRules[feature] === null ? label : `${label} (neste site)`,
    checked: p.toggles[feature],
    enabled: !p.tabPaused,
    command: { type: 'privacy:set', scope: 'site', feature, enabled: !p.toggles[feature] },
  });
  return [
    { kind: 'info', label: `Proteção em ${p.site}` },
    { kind: 'info', label: p.tabPaused ? 'Pausada nesta aba' : `Nesta página: ${ads} anúncios e ${trackers} rastreadores bloqueados` },
    { kind: 'separator' },
    ...QUICK.map(toggle),
    // Antes ficavam no painel do site (⚙), que agora é só de permissões.
    { kind: 'submenu', label: 'Mais proteções', items: MORE.map(toggle) },
    { kind: 'separator' },
    { kind: 'action', label: 'Usar o padrão neste site', enabled: hasOverride, command: { type: 'privacy:reset-site' } },
    { kind: 'check', label: 'Pausar proteção nesta aba', checked: p.tabPaused, enabled: true,
      command: { type: 'privacy:pause-tab', paused: !p.tabPaused } },
  ];
}
