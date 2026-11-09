import { describe, expect, it } from 'vitest';
import type { SitePrivacy } from '../../src/shared/types';
import { privacyMenu } from '../../src/main/privacy/menu';
import { shieldState } from '../../src/shared/shield';

const site = (over: Partial<SitePrivacy> = {}): SitePrivacy => ({
  site: 'office.com',
  toggles: { ads: true, trackers: true, thirdPartyCookies: true, urlCleaning: true },
  source: { ads: 'default', trackers: 'default', thirdPartyCookies: 'default', urlCleaning: 'default' },
  siteRules: { ads: null, trackers: null, thirdPartyCookies: null, urlCleaning: null },
  tabPaused: false,
  blocked: { ads: 3, trackers: 5 },
  ...over,
});
const checks = (p: SitePrivacy) => privacyMenu(p).filter((i) => i.kind === 'check');

describe('privacyMenu', () => {
  it('mostra o domínio e o que foi bloqueado', () => {
    const labels = privacyMenu(site()).filter((i) => i.kind === 'info').map((i) => (i as { label: string }).label);
    expect(labels).toEqual(['Proteção em office.com', 'Nesta página: 3 anúncios e 5 rastreadores bloqueados']);
  });

  it('desmarcar grava regra do site com o valor oposto ao atual (sobrescreve o padrão)', () => {
    const [ads, trackers] = checks(site());
    expect(ads).toMatchObject({ checked: true, command: { type: 'privacy:set', scope: 'site', feature: 'ads', enabled: false } });
    expect(trackers).toMatchObject({ checked: true, command: { type: 'privacy:set', scope: 'site', feature: 'trackers', enabled: false } });
  });

  it('com regra do site: indica "(neste site)" e permite voltar ao padrão', () => {
    const p = site({ toggles: { ...site().toggles, trackers: false }, siteRules: { ...site().siteRules, trackers: false } });
    const [, trackers] = checks(p);
    expect(trackers).toMatchObject({ label: 'Bloquear rastreadores (neste site)', checked: false,
      command: { type: 'privacy:set', feature: 'trackers', enabled: true } });
    expect(privacyMenu(p).find((i) => i.kind === 'action')).toMatchObject({ enabled: true, command: { type: 'privacy:reset-site' } });
    expect(privacyMenu(site()).find((i) => i.kind === 'action')).toMatchObject({ enabled: false });
  });

  it('pausado na aba: interruptores do site desabilitados; item de pausa desfaz', () => {
    const p = site({ tabPaused: true });
    const [ads, trackers, pause] = checks(p);
    expect(ads.kind === 'check' && ads.enabled).toBe(false);
    expect(trackers.kind === 'check' && trackers.enabled).toBe(false);
    expect(pause).toMatchObject({ checked: true, command: { type: 'privacy:pause-tab', paused: false } });
  });
});

describe('shieldState', () => {
  it('on / partial / off', () => {
    expect(shieldState(site())).toBe('on');
    expect(shieldState(site({ toggles: { ...site().toggles, ads: false } }))).toBe('partial');
    expect(shieldState(site({ toggles: { ...site().toggles, ads: false, trackers: false } }))).toBe('off');
    expect(shieldState(site({ tabPaused: true }))).toBe('off');
  });
});
