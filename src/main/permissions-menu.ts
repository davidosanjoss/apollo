// Menu da engrenagem: permissões do site (câmera, microfone, localização…).
import type { PermissionDecision, PermissionKind, SitePermissions } from '../shared/types';
import { PERMISSION_LABELS } from '../shared/types';
import type { MenuModelItem } from './menu-model';

/** O que vale sem regra: notificações não têm "perguntar" (ver ARCHITECTURE D10). */
const defaultLabel = (kind: PermissionKind) => (kind === 'notifications' ? 'bloqueado' : 'perguntar');

const DECISION_TEXT: Record<PermissionDecision, string> = { allow: 'permitido', deny: 'bloqueado' };

export function permissionsMenu(info: SitePermissions): MenuModelItem[] {
  const host = new URL(info.origin).host;
  return [
    { kind: 'info', label: `Permissões em ${host}` },
    { kind: 'separator' },
    ...info.entries.map(({ kind, decision }): MenuModelItem => ({
      kind: 'submenu',
      label: `${PERMISSION_LABELS[kind]}: ${decision ? DECISION_TEXT[decision] : `padrão (${defaultLabel(kind)})`}`,
      items: ([[null, `Padrão (${defaultLabel(kind)})`], ['allow', 'Permitir'], ['deny', 'Bloquear']] as const).map(([d, label]) => ({
        kind: 'radio',
        label,
        checked: decision === d,
        command: { type: 'permission:set', origin: info.origin, kind, decision: d },
      })),
    })),
  ];
}
