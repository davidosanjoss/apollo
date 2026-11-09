// Filtros cosméticos (esconder espaços de anúncio) e scriptlets (+js, ex.: YouTube).
import type { FiltersEngine } from '@ghostery/adblocker';
import { parse } from 'tldts';

export interface DomFeatures {
  classes: string[];
  ids: string[];
  hrefs: string[];
}

export interface CosmeticResult {
  styles: string;
  scripts: string[];
}

/**
 * Início da página: regras do site + genéricas + scriptlets.
 * Com `features` (mudanças no DOM): só seletores para as classes/ids/links novos.
 */
export function cosmeticsFor(engine: FiltersEngine, url: string, features?: DomFeatures): CosmeticResult | null {
  const { hostname, domain } = parse(url);
  if (!hostname || !/^https?:/i.test(url)) return null;
  const start = features === undefined;
  const { active, styles, scripts } = engine.getCosmeticsFilters({
    url,
    hostname,
    domain: domain ?? hostname,
    classes: features?.classes,
    ids: features?.ids,
    hrefs: features?.hrefs,
    getBaseRules: start,
    getInjectionRules: start,
    getExtendedRules: start,
    getRulesFromHostname: start,
    getRulesFromDOM: !start,
  });
  if (active === false) return null;
  return { styles, scripts: start ? scripts : [] };
}

const MAX_ITEMS = 2000;
const MAX_LEN = 512;
const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length <= MAX_ITEMS && v.every((x) => typeof x === 'string' && x.length <= MAX_LEN) ? v : null;

/** Valida o que vem da página (não confiável). */
export function parseFeatures(raw: unknown): DomFeatures | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const classes = strings(r.classes);
  const ids = strings(r.ids);
  const hrefs = strings(r.hrefs);
  return classes && ids && hrefs ? { classes, ids, hrefs } : null;
}
