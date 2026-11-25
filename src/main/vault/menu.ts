// Menu da chave na barra de endereço (modelo puro; o Browser converte em menu nativo).
import type { MenuModelItem } from '../menu-model';
import type { VaultLogin } from './vault';

/** Gerar senha não precisa do cofre (é local). */
/** Códigos de verificação: a lista e cadastrar o autenticador do site (só com o cofre aberto). */
const AUTHENTICATOR: MenuModelItem[] = [
  { kind: 'separator' },
  { kind: 'action', label: 'Códigos de verificação…', enabled: true, command: { type: 'vault:totp-codes', open: true } },
  { kind: 'action', label: 'Configurar app autenticador desta página…', enabled: true, command: { type: 'totp:scan' } },
];

const GENERATE: MenuModelItem[] = [
  { kind: 'separator' },
  { kind: 'action', label: 'Gerar senha e preencher', enabled: true, command: { type: 'vault:generate', fill: true } },
  { kind: 'action', label: 'Gerar senha e copiar', enabled: true, command: { type: 'vault:generate', fill: false } },
];

/** O site está esperando um login com passkey ("condicional"): as passkeys dele, no topo. */
export type PasskeyOption = { id: string; label: string };

export function vaultMenu(status: 'disconnected' | 'locked' | 'unlocked', matches: VaultLogin[], site: string, passkeys: PasskeyOption[] = []): MenuModelItem[] {
  const pk: MenuModelItem[] = passkeys.length ? [
    ...passkeys.map((p): MenuModelItem => ({ kind: 'action', label: `Entrar com passkey — ${p.label}`, enabled: true, command: { type: 'passkey:use', optionId: p.id } })),
    { kind: 'separator' },
  ] : [];
  if (status === 'disconnected') return [{ kind: 'action', label: 'Conectar o Bitwarden…', enabled: true, command: { type: 'vault:open' } }, ...GENERATE];
  if (status === 'locked') {
    return [{ kind: 'info', label: 'Cofre bloqueado' }, { kind: 'action', label: 'Desbloquear…', enabled: true, command: { type: 'vault:open' } }, ...GENERATE];
  }
  if (!matches.length) return [...pk, { kind: 'info', label: `Nenhum login salvo para ${site}` }, ...AUTHENTICATOR, ...GENERATE];
  return [
    ...pk,
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
        ...(l.hasTotp ? [
          { kind: 'action' as const, label: 'Preencher código de verificação', enabled: true, command: { type: 'vault:fill-totp' as const, itemId: l.id } },
          { kind: 'action' as const, label: 'Copiar código de verificação (TOTP)', enabled: true,
            command: { type: 'vault:copy' as const, itemId: l.id, what: 'totp' as const } }] : []),
      ],
    })),
    ...AUTHENTICATOR,
    ...GENERATE,
  ];
}
