import { FiltersEngine } from '@ghostery/adblocker';
import { describe, expect, it, vi } from 'vitest';
import type { OnBeforeRequestListenerDetails } from 'electron';
import { Blocker, blockerModule, requestType } from '../../src/main/privacy/blocker';
import { DEFAULT_TOGGLES } from '../../src/main/privacy/rules';

const engines = () => ({
  ads: FiltersEngine.parse('||ads.example^\n||cdn.example/noop.js$script,redirect=noopjs', { loadCosmeticFilters: false }),
  tracking: FiltersEngine.parse('||tracker.example^', { loadCosmeticFilters: false }),
});
const ON = { ...DEFAULT_TOGGLES };
const SITE = 'https://news.site/artigo';

describe('requestType', () => {
  it('converte os tipos do Electron', () => {
    expect(requestType('xhr')).toBe('xmlhttprequest');
    expect(requestType('subFrame')).toBe('sub_frame');
    expect(requestType('webSocket')).toBe('websocket');
    expect(requestType('desconhecido')).toBe('other');
  });
});

describe('Blocker.check', () => {
  const b = new Blocker(engines());

  it('bloqueia anúncio e rastreador, cada um no seu interruptor', () => {
    expect(b.check('https://ads.example/b.js', 'script', SITE, ON)).toEqual({ kind: 'ads' });
    expect(b.check('https://tracker.example/p.gif', 'image', SITE, ON)).toEqual({ kind: 'trackers' });
    expect(b.check('https://ads.example/b.js', 'script', SITE, { ...ON, ads: false })).toBeNull();
    expect(b.check('https://tracker.example/p.gif', 'image', SITE, { ...ON, trackers: false })).toBeNull();
  });

  it('não bloqueia o que não está nas listas', () => {
    expect(b.check('https://news.site/app.js', 'script', SITE, ON)).toBeNull();
  });

  it('nunca bloqueia a navegação principal nem esquemas internos', () => {
    expect(b.check('https://ads.example/', 'mainFrame', null, ON)).toBeNull();
    expect(b.check('apollo://home', 'script', SITE, ON)).toBeNull();
    expect(b.check('data:text/javascript,1', 'script', SITE, ON)).toBeNull();
  });

  it('redirect=noopjs troca por um script vazio (página não quebra)', () => {
    const d = b.check('https://cdn.example/noop.js', 'script', SITE, ON)!;
    expect(d.kind).toBe('ads');
    expect(d.redirectURL).toMatch(/^data:/);
  });

  it('troca de motores (atualização das listas) vale na hora', () => {
    const b2 = new Blocker(engines());
    b2.setEngines({ ads: FiltersEngine.empty(), tracking: FiltersEngine.empty() });
    expect(b2.check('https://ads.example/b.js', 'script', SITE, ON)).toBeNull();
  });
});

describe('blockerModule', () => {
  const details = (over: Partial<OnBeforeRequestListenerDetails>) =>
    ({ url: 'https://ads.example/b.js', resourceType: 'script', referrer: '', ...over }) as OnBeforeRequestListenerDetails;

  it('cancela, conta e usa a página da aba como primeira parte', () => {
    const togglesFor = vi.fn(() => ON);
    const onBlocked = vi.fn();
    const mod = blockerModule(new Blocker(engines()), { togglesFor, onBlocked });
    const ctx = { workspaceId: 'w', tabId: 't', tabUrl: SITE };
    expect(mod.onBeforeRequest!(details({}), ctx)).toEqual({ cancel: true });
    expect(togglesFor).toHaveBeenCalledWith(ctx, SITE);
    expect(onBlocked).toHaveBeenCalledWith(ctx, 'ads');
  });

  it('sem aba (service worker): usa o referrer como primeira parte', () => {
    const togglesFor = vi.fn(() => ON);
    const mod = blockerModule(new Blocker(engines()), { togglesFor, onBlocked: vi.fn() });
    mod.onBeforeRequest!(details({ referrer: 'https://outro.site/' }), { workspaceId: 'w', tabId: null, tabUrl: null });
    expect(togglesFor).toHaveBeenCalledWith(expect.anything(), 'https://outro.site/');
  });

  it('liberado: passa sem contar', () => {
    const onBlocked = vi.fn();
    const mod = blockerModule(new Blocker(engines()), { togglesFor: () => ({ ...ON, ads: false, trackers: false }), onBlocked });
    expect(mod.onBeforeRequest!(details({}), { workspaceId: 'w', tabId: 't', tabUrl: SITE })).toBeUndefined();
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
