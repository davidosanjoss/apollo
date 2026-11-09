import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FiltersEngine } from '@ghostery/adblocker';
import { describe, expect, it } from 'vitest';
import { cosmeticsFor, parseFeatures } from '../../src/main/privacy/cosmetics';

const engine = FiltersEngine.parse([
  'site.com##.anuncio',
  '##.ad-generico',
  'outro.com#@#.anuncio',
].join('\n'), { loadCosmeticFilters: true });

describe('cosmeticsFor', () => {
  it('início da página: regras do site', () => {
    const r = cosmeticsFor(engine, 'https://www.site.com/x')!;
    expect(r.styles).toContain('.anuncio');
    expect(r.scripts).toEqual([]);
  });

  it('mudança no DOM: só seletores genéricos para as classes vistas', () => {
    const r = cosmeticsFor(engine, 'https://news.com/', { classes: ['ad-generico', 'outra'], ids: [], hrefs: [] })!;
    expect(r.styles).toContain('.ad-generico');
    expect(cosmeticsFor(engine, 'https://news.com/', { classes: ['nada'], ids: [], hrefs: [] })!.styles).toBe('');
  });

  it('não é página web: nada', () => {
    expect(cosmeticsFor(engine, 'apollo://home')).toBeNull();
    expect(cosmeticsFor(engine, 'data:text/html,x')).toBeNull();
  });

  // Regressão: sem os recursos do uBlock, scriptlets (+js) não eram gerados
  // (anúncios do YouTube passavam). Usa o arquivo baixado pelo build, se existir.
  const resourcesFile = path.join('.cache/filters', createHash('sha256')
    .update('https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json')
    .digest('hex').slice(0, 16) + '.txt');
  it.skipIf(!fs.existsSync(resourcesFile))('scriptlets saem quando os recursos estão no motor', () => {
    const e = FiltersEngine.parse('site.com##+js(set-constant, adsEnabled, false)', { loadCosmeticFilters: true });
    expect(cosmeticsFor(e, 'https://site.com/')!.scripts).toEqual([]);
    const res = fs.readFileSync(resourcesFile, 'utf8');
    e.updateResources(res, String(res.length));
    const r = cosmeticsFor(e, 'https://site.com/')!;
    expect(r.scripts).toHaveLength(1);
    expect(r.scripts[0]).toContain('adsEnabled');
  });
});

describe('parseFeatures (dados da página: não confiáveis)', () => {
  it('aceita listas de strings', () => {
    expect(parseFeatures({ classes: ['a'], ids: [], hrefs: ['/x'] })).toEqual({ classes: ['a'], ids: [], hrefs: ['/x'] });
  });

  it('rejeita formatos errados e exageros', () => {
    expect(parseFeatures(null)).toBeNull();
    expect(parseFeatures({ classes: 'a', ids: [], hrefs: [] })).toBeNull();
    expect(parseFeatures({ classes: [1], ids: [], hrefs: [] })).toBeNull();
    expect(parseFeatures({ classes: ['x'.repeat(513)], ids: [], hrefs: [] })).toBeNull();
    expect(parseFeatures({ classes: Array(2001).fill('a'), ids: [], hrefs: [] })).toBeNull();
  });
});
