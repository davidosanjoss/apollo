import { describe, expect, it } from 'vitest';
import { DEFAULT_TOGGLES, resolve, siteOf, type Layers } from '../../src/main/privacy/rules';

const layers = (over: Partial<Layers> = {}): Layers => ({ global: {}, workspace: {}, site: {}, tab: {}, ...over });

describe('resolve (camadas)', () => {
  it('sem regras: padrão do Apollo (tudo bloqueado)', () => {
    expect(resolve(layers())).toEqual({ toggles: DEFAULT_TOGGLES,
      source: { ads: 'default', trackers: 'default', thirdPartyCookies: 'default', urlCleaning: 'default' } });
    expect(DEFAULT_TOGGLES).toEqual({ ads: true, trackers: true, thirdPartyCookies: true, urlCleaning: true });
  });

  it('a camada mais específica vence, por interruptor', () => {
    const r = resolve(layers({ global: { ads: false, trackers: false }, workspace: { trackers: true }, site: { ads: true } }));
    expect(r.toggles).toMatchObject({ ads: true, trackers: true });
    expect(r.source).toMatchObject({ ads: 'site', trackers: 'workspace' });
  });

  it('aba (temporária) vence tudo', () => {
    const r = resolve(layers({ site: { ads: true, trackers: true }, tab: { ads: false, trackers: false } }));
    expect(r.toggles).toMatchObject({ ads: false, trackers: false });
    expect(r.source.ads).toBe('tab');
  });

  it('exemplo do Outlook: trabalho libera rastreadores no site, pessoal bloqueia', () => {
    const trabalho = resolve(layers({ site: { trackers: false } }));
    const pessoal = resolve(layers());
    expect(trabalho.toggles.trackers).toBe(false);
    expect(pessoal.toggles.trackers).toBe(true);
  });
});

describe('siteOf', () => {
  it.each([
    ['https://outlook.office.com/mail/', 'office.com'],
    ['https://www.youtube.com/watch?v=1', 'youtube.com'],
    ['https://portal.ufmg.br/x', 'ufmg.br'],
    ['https://a.b.gov.br/', 'b.gov.br'],
    ['https://usuario.github.io/', 'usuario.github.io'],
    ['http://127.0.0.1:8080/', '127.0.0.1'],
    ['http://localhost:3000/', 'localhost'],
  ])('%s → %s', (url, site) => expect(siteOf(url)).toBe(site));

  it('não é site: páginas internas, vazio, inválido', () => {
    expect(siteOf('apollo://home')).toBeNull();
    expect(siteOf('')).toBeNull();
    expect(siteOf('nada')).toBeNull();
    expect(siteOf('data:text/html,x')).toBeNull();
  });
});
