// Carrega os motores de bloqueio e os mantém atualizados.
//   - Embutidos no app (build/filters/*.bin, montados no build).
//   - Atualização semanal em segundo plano, numa thread separada (filters-worker),
//     direto das listas públicas; salvos em <userData>/filters.
//   - Testes: APOLLO_TEST_FILTERS_ADS / _TRACKING apontam para listas de texto.
import { FiltersEngine } from '@ghostery/adblocker';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { emptyEngine, type Engines } from './blocker';

const BUNDLED = path.join(__dirname, 'filters');
const WEEK_MS = 7 * 24 * 3600 * 1000;
export const ENGINE_CONFIG = { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true };

function readEngine(file: string): FiltersEngine | null {
  try {
    return FiltersEngine.deserialize(new Uint8Array(fs.readFileSync(file)));
  } catch {
    return null; // arquivo ausente, corrompido ou de outra versão do motor
  }
}

const mtime = (file: string) => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };

export function testFiltersEnabled(): boolean {
  return Boolean(process.env.APOLLO_TEST_FILTERS_ADS || process.env.APOLLO_TEST_FILTERS_TRACKING);
}

/** Motor mais novo entre o baixado e o embutido. Nunca falha: no pior caso, vazio. */
export function loadEngines(userData: string): Engines {
  if (testFiltersEnabled()) {
    const resources = process.env.APOLLO_TEST_FILTERS_RESOURCES;
    const parse = (f: string | undefined) => {
      const engine = f ? FiltersEngine.parse(fs.readFileSync(f, 'utf8'), ENGINE_CONFIG) : emptyEngine();
      if (resources) { const r = fs.readFileSync(resources, 'utf8'); engine.updateResources(r, String(r.length)); }
      return engine;
    };
    return { ads: parse(process.env.APOLLO_TEST_FILTERS_ADS), tracking: parse(process.env.APOLLO_TEST_FILTERS_TRACKING) };
  }
  const pick = (name: string) => {
    const downloaded = path.join(userData, 'filters', name);
    const bundled = path.join(BUNDLED, name);
    const order = mtime(downloaded) > mtime(bundled) ? [downloaded, bundled] : [bundled, downloaded];
    for (const f of order) { const e = readEngine(f); if (e) return e; }
    console.warn(`[apollo] listas de bloqueio indisponíveis (${name}): bloqueio desligado até a próxima atualização`);
    return emptyEngine();
  };
  return { ads: pick('ads.bin'), tracking: pick('tracking.bin') };
}

/** Idade das listas em uso (a mais nova entre baixada e embutida). */
function listsAge(userData: string): number {
  const newest = Math.max(mtime(path.join(userData, 'filters', 'ads.bin')), mtime(path.join(BUNDLED, 'ads.bin')));
  return Date.now() - newest;
}

/** Baixa e monta as listas numa thread separada; grava e devolve os motores novos. */
export function refreshEngines(userData: string): Promise<Engines | null> {
  return new Promise((resolve) => {
    const worker = new Worker(path.join(__dirname, 'filters-worker.js'));
    const timer = setTimeout(() => { void worker.terminate(); resolve(null); }, 5 * 60_000);
    worker.once('message', (msg: { ok: boolean; ads?: Uint8Array; tracking?: Uint8Array; error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (!msg.ok || !msg.ads || !msg.tracking) {
        console.warn('[apollo] atualização das listas falhou:', msg.error);
        return resolve(null);
      }
      const dir = path.join(userData, 'filters');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'ads.bin'), msg.ads);
      fs.writeFileSync(path.join(dir, 'tracking.bin'), msg.tracking);
      resolve({ ads: FiltersEngine.deserialize(msg.ads), tracking: FiltersEngine.deserialize(msg.tracking) });
    });
    worker.once('error', (err) => { clearTimeout(timer); console.warn('[apollo] worker das listas:', err.message); resolve(null); });
  });
}

/** Agenda a verificação semanal (primeira 2 min depois de abrir; leve quando nada a fazer). */
export function scheduleFilterUpdates(userData: string, apply: (engines: Engines) => void): void {
  if (testFiltersEnabled()) return;
  const check = async () => {
    if (listsAge(userData) < WEEK_MS) return;
    const engines = await refreshEngines(userData);
    if (engines) {
      apply(engines);
      console.log('[apollo] listas de bloqueio atualizadas');
    }
  };
  setTimeout(() => void check(), 2 * 60_000).unref();
  setInterval(() => void check(), 6 * 3600_000).unref();
}
