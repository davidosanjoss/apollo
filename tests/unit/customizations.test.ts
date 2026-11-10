import { describe, expect, it } from 'vitest';
import { customizationsFor, siteMatches, type Customization } from '../../src/main/customizations';
import { MODULES, parseModules } from '../../src/main/modules';

describe('siteMatches', () => {
  it('domínio vale para ele e subdomínios', () => {
    expect(siteMatches('youtube.com', 'https://www.youtube.com/watch?v=1')).toBe(true);
    expect(siteMatches('youtube.com', 'https://music.youtube.com/')).toBe(true);
    expect(siteMatches('youtube.com', 'https://notyoutube.com/')).toBe(false);
    expect(siteMatches('youtube.com', 'https://youtube.com.golpe.ru/')).toBe(false);
  });

  it('lista, curinga, esquema/caminho colados por engano', () => {
    expect(siteMatches('moodle.ufmg.br, youtube.com', 'https://moodle.ufmg.br/curso')).toBe(true);
    expect(siteMatches('*', 'https://qualquer.com/')).toBe(true);
    expect(siteMatches('*.ufmg.br', 'https://portal.ufmg.br/')).toBe(true);
    expect(siteMatches('https://moodle.ufmg.br/login', 'https://moodle.ufmg.br/curso')).toBe(true);
  });

  it('nunca em páginas internas nem com lista vazia', () => {
    expect(siteMatches('*', 'apollo://home')).toBe(false);
    expect(siteMatches('', 'https://a.com/')).toBe(false);
  });
});

describe('customizationsFor', () => {
  const c = (id: string, sites: string, enabled = true): Customization => ({ id, name: id, sites, css: '', js: '', enabled });
  it('só as ligadas e do site', () => {
    expect(customizationsFor([c('a', 'a.com'), c('b', 'b.com'), c('off', '*', false), c('all', '*')], 'https://a.com/').map((x) => x.id))
      .toEqual(['a', 'all']);
  });
});

describe('parseModules', () => {
  it('padrão: tudo ligado; desligados salvos; lixo vira padrão', () => {
    expect(Object.values(parseModules(null)).every(Boolean)).toBe(true);
    expect(parseModules('{"gpc": false}').gpc).toBe(false);
    expect(parseModules('{"gpc": false}').cosmetics).toBe(true);
    expect(parseModules('{lixo').gpc).toBe(true);
    expect(Object.keys(parseModules(null))).toEqual(MODULES.map((m) => m.id));
  });
});
