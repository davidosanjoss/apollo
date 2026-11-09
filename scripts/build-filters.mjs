// Monta os motores de bloqueio (Ghostery) a partir das listas públicas e grava em
// build/filters/{ads,tracking}.bin, embutidos no app. As listas baixadas ficam em
// cache (.cache/filters) por 7 dias para não baixar a cada build.
//
// Sem internet e sem cache: grava motores vazios (o app funciona, só não bloqueia
// até a atualização semanal em segundo plano trazer as listas).
import { FiltersEngine, adsLists, adsAndTrackingLists } from '@ghostery/adblocker';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CACHE = '.cache/filters';
const OUT = 'build/filters';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export const trackingLists = adsAndTrackingLists.filter((u) => !adsLists.includes(u));
// Recursos do uBlock (scriptlets e recursos "neutros" de redirect). Sem eles, nada de +js().
export const RESOURCES_URL = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json';
export const ENGINE_CONFIG = { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true };

async function getList(url) {
  const file = path.join(CACHE, createHash('sha256').update(url).digest('hex').slice(0, 16) + '.txt');
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < MAX_AGE_MS) return readFileSync(file, 'utf8');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(file, text);
    return text;
  } catch (err) {
    if (existsSync(file)) return readFileSync(file, 'utf8'); // cache vencido é melhor que nada
    console.warn(`[filters] não consegui baixar ${url}: ${err.message}`);
    return '';
  }
}

async function buildEngine(urls, resources) {
  const texts = await Promise.all(urls.map(getList));
  const engine = FiltersEngine.parse(texts.join('\n'), ENGINE_CONFIG);
  if (resources) engine.updateResources(resources, String(resources.length));
  return engine;
}

export async function buildFilters() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const resources = await getList(RESOURCES_URL);
  const [ads, tracking] = await Promise.all([buildEngine(adsLists, resources), buildEngine(trackingLists, resources)]);
  writeFileSync(path.join(OUT, 'ads.bin'), ads.serialize());
  writeFileSync(path.join(OUT, 'tracking.bin'), tracking.serialize());
  const size = (f) => (statSync(path.join(OUT, f)).size / 1024 / 1024).toFixed(1);
  console.log(`[filters] anúncios ${size('ads.bin')} MB, rastreadores ${size('tracking.bin')} MB`);
}

if (import.meta.url === `file://${process.argv[1]}`) await buildFilters();
