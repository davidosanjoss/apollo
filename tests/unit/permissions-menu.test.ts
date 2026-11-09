import { describe, expect, it } from 'vitest';
import type { SitePermissions } from '../../src/shared/types';
import { permissionsMenu } from '../../src/main/permissions-menu';
import { hasCustomPermissions } from '../../src/shared/shield';

const info = (decisions: Partial<Record<string, 'allow' | 'deny'>> = {}): SitePermissions => ({
  origin: 'https://teams.microsoft.com',
  entries: (['notifications', 'media-video', 'media-audio', 'geolocation'] as const).map((kind) => ({ kind, decision: decisions[kind] ?? null })),
});

describe('permissionsMenu', () => {
  it('título com o domínio e um submenu por permissão', () => {
    const items = permissionsMenu(info());
    expect(items[0]).toEqual({ kind: 'info', label: 'Permissões em teams.microsoft.com' });
    expect(items.filter((i) => i.kind === 'submenu').map((i) => i.kind === 'submenu' && i.label)).toEqual([
      'Notificações: padrão (bloqueado)', 'Câmera: padrão (perguntar)', 'Microfone: padrão (perguntar)', 'Localização: padrão (perguntar)',
    ]);
  });

  it('opção atual marcada; cada opção grava a decisão (null = padrão)', () => {
    const cam = permissionsMenu(info({ 'media-video': 'allow' })).find((i) => i.kind === 'submenu' && i.label.startsWith('Câmera'))!;
    expect(cam.kind === 'submenu' && cam.label).toBe('Câmera: permitido');
    const radios = cam.kind === 'submenu' ? cam.items : [];
    expect(radios.map((r) => r.kind === 'radio' && [r.label, r.checked])).toEqual([['Padrão (perguntar)', false], ['Permitir', true], ['Bloquear', false]]);
    expect(radios.map((r) => r.kind === 'radio' && r.command)).toEqual([
      { type: 'permission:set', origin: 'https://teams.microsoft.com', kind: 'media-video', decision: null },
      { type: 'permission:set', origin: 'https://teams.microsoft.com', kind: 'media-video', decision: 'allow' },
      { type: 'permission:set', origin: 'https://teams.microsoft.com', kind: 'media-video', decision: 'deny' },
    ]);
  });

  it('destaque quando há permissão definida', () => {
    expect(hasCustomPermissions(info())).toBe(false);
    expect(hasCustomPermissions(info({ geolocation: 'deny' }))).toBe(true);
  });
});
