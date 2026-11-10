import { describe, expect, it } from 'vitest';
import { vaultMenu } from '../../src/main/vault/menu';
import type { VaultLogin } from '../../src/main/vault/vault';

const login = (over: Partial<VaultLogin> = {}): VaultLogin =>
  ({ id: 'i1', name: 'Outlook', username: 'eu@empresa.com', uris: [], hasTotp: false, organizationId: null, ...over });

describe('vaultMenu', () => {
  it('gerar senha em todos os estados (não precisa do cofre)', () => {
    for (const st of ['disconnected', 'locked', 'unlocked'] as const) {
      const cmds = vaultMenu(st, [], 'x.com').flatMap((i) => (i.kind === 'action' ? [i.command] : []));
      expect(cmds).toContainEqual({ type: 'vault:generate', fill: true });
      expect(cmds).toContainEqual({ type: 'vault:generate', fill: false });
    }
  });

  it('desconectado / bloqueado: leva ao diálogo do cofre', () => {
    expect(vaultMenu('disconnected', [], 'office.com')[0]).toMatchObject({ kind: 'action', command: { type: 'vault:open' } });
    expect(vaultMenu('locked', [login()], 'office.com').slice(0, 2)).toMatchObject([{ kind: 'info' }, { kind: 'action', label: 'Desbloquear…' }]);
  });

  it('sem login para o site', () => {
    expect(vaultMenu('unlocked', [], 'office.com')[0]).toEqual({ kind: 'info', label: 'Nenhum login salvo para office.com' });
  });

  it('um submenu por login: preencher, copiar usuário/senha; TOTP só se houver', () => {
    const items = vaultMenu('unlocked', [login(), login({ id: 'i2', name: 'Admin', username: null, hasTotp: true })], 'office.com');
    const subs = items.filter((i) => i.kind === 'submenu');
    expect(subs.map((s) => s.kind === 'submenu' && s.label)).toEqual(['Outlook — eu@empresa.com', 'Admin']);
    const first = subs[0].kind === 'submenu' ? subs[0].items : [];
    expect(first.filter((i) => i.kind === 'action').map((i) => i.kind === 'action' && i.command)).toEqual([
      { type: 'vault:fill', itemId: 'i1' }, { type: 'vault:copy', itemId: 'i1', what: 'username' }, { type: 'vault:copy', itemId: 'i1', what: 'password' },
    ]);
    const second = subs[1].kind === 'submenu' ? subs[1].items : [];
    expect(second.find((i) => i.kind === 'action' && i.label === 'Copiar usuário')).toMatchObject({ enabled: false });
    expect(second.some((i) => i.kind === 'action' && i.label.includes('TOTP'))).toBe(true);
  });
});
