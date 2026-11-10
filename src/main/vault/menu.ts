// Menu da chave na barra de endereço (modelo puro; o Browser converte em menu nativo).
import type { MenuModelItem } from '../menu-model';
import type { VaultLogin } from './vault';

/** Gerar senha não precisa do cofre (é local). */
const GENERATE: MenuModelItem[] = [
  { kind: 'separator' },
  { kind: 'action', label: 'Gerar senha e preencher', enabled: true, command: { type: 'vault:generate', fill: true } },
  { kind: 'action', label: 'Gerar senha e copiar', enabled: true, command: { type: 'vault:generate', fill: false } },
];

export function vaultMenu(status: 'disconnected' | 'locked' | 'unlocked', matches: VaultLogin[], site: string): MenuModelItem[] {
  if (status === 'disconnected') return [{ kind: 'action', label: 'Conectar o Bitwarden…', enabled: true, command: { type: 'vault:open' } }, ...GENERATE];
  if (status === 'locked') {
    return [{ kind: 'info', label: 'Cofre bloqueado' }, { kind: 'action', label: 'Desbloquear…', enabled: true, command: { type: 'vault:open' } }, ...GENERATE];
  }
  if (!matches.length) return [{ kind: 'info', label: `Nenhum login salvo para ${site}` }, ...GENERATE];
  return [
    { kind: 'info', label: `Logins para ${site}` },
    { kind: 'separator' },
    ...matches.map((l): MenuModelItem => ({
      kind: 'submenu',
      label: l.username ? `${l.name} — ${l.username}` : l.name,
      items: [
        { kind: 'action', label: 'Preencher', enabled: true, command: { type: 'vault:fill', itemId: l.id } },
        { kind: 'separator' },
        { kind: 'action', label: 'Copiar usuário', enabled: Boolean(l.username), command: { type: 'vault:copy', itemId: l.id, what: 'username' } },
        { kind: 'action', label: 'Copiar senha', enabled: true, command: { type: 'vault:copy', itemId: l.id, what: 'password' } },
        ...(l.hasTotp ? [{ kind: 'action' as const, label: 'Copiar código de verificação (TOTP)', enabled: true,
          command: { type: 'vault:copy' as const, itemId: l.id, what: 'totp' as const } }] : []),
      ],
    })),
    ...GENERATE,
  ];
}
