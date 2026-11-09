// Thread separada: baixa as listas públicas e monta os motores (CPU pesada),
// sem travar o processo principal.
import { FiltersEngine, adsAndTrackingLists, adsLists } from '@ghostery/adblocker';
import { parentPort } from 'node:worker_threads';

const CONFIG = { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true };
const trackingLists = adsAndTrackingLists.filter((u) => !adsLists.includes(u));
const RESOURCES_URL = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json';

async function get(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function build(urls: string[], resources: string): Promise<Uint8Array> {
  const texts = await Promise.all(urls.map(get));
  const engine = FiltersEngine.parse(texts.join('\n'), CONFIG);
  engine.updateResources(resources, String(resources.length));
  return engine.serialize();
}

get(RESOURCES_URL)
  .then((resources) => Promise.all([build(adsLists, resources), build(trackingLists, resources)]))
  .then(([ads, tracking]) => parentPort!.postMessage({ ok: true, ads, tracking }, [ads.buffer, tracking.buffer] as ArrayBuffer[]))
  .catch((err: Error) => parentPort!.postMessage({ ok: false, error: err.message }));
