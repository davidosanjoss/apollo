// Thread separada: baixa as listas públicas e monta os motores (CPU pesada),
// sem travar o processo principal.
import { FiltersEngine, adsAndTrackingLists, adsLists } from '@ghostery/adblocker';
import { parentPort } from 'node:worker_threads';

const CONFIG = { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true };
const trackingLists = adsAndTrackingLists.filter((u) => !adsLists.includes(u));

async function build(urls: string[]): Promise<Uint8Array> {
  const texts = await Promise.all(urls.map(async (u) => {
    const res = await fetch(u, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
    return res.text();
  }));
  return FiltersEngine.parse(texts.join('\n'), CONFIG).serialize();
}

Promise.all([build(adsLists), build(trackingLists)])
  .then(([ads, tracking]) => parentPort!.postMessage({ ok: true, ads, tracking }, [ads.buffer, tracking.buffer] as ArrayBuffer[]))
  .catch((err: Error) => parentPort!.postMessage({ ok: false, error: err.message }));
