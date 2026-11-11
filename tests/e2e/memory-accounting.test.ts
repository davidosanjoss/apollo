// Regressão (relatado): o monitor de memória mostrava ~5,5 GB com o sistema em ~2,8 GB
// (somava o RSS de cada processo, contando várias vezes a memória compartilhada). O total
// agora é a soma do PSS, que bate com o uso real.
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, type Cdp, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let main: Cdp;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1' });
  main = await app.main();
  for (const t of ['Um', 'Dois', 'Tres']) {
    await app.send({ type: 'tab:new', url: `${site.url}/page?title=${t}` });
    await app.until((s) => app.activeTab(s).title === t && !app.activeTab(s).loading, t);
  }
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const sumKb = (pids: number[], field: 'Pss' | 'Rss') => pids.reduce((acc, pid) => {
  try {
    const m = new RegExp(`^${field}:\\s+(\\d+) kB`, 'm').exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
    return acc + (m ? Number(m[1]) : 0);
  } catch { return acc; }
}, 0);

describe.skipIf(process.platform !== 'linux')('contabilidade de memória', () => {
  it('total do monitor ≈ soma do PSS dos processos (e bem abaixo da soma do RSS)', async () => {
    await app.send({ type: 'memory:toggle', open: true });
    const s = await app.until((x) => x.memory !== null && x.memory.totalMb > 0, 'monitor');
    const pids = await main.eval<number[]>(`process.mainModule.require('electron').app.getAppMetrics().map((m) => m.pid)`);
    const pssMb = sumKb(pids, 'Pss') / 1024;
    const rssMb = sumKb(pids, 'Rss') / 1024;
    process.stderr.write(`[memória] monitor=${s.memory!.totalMb} MB · PSS=${Math.round(pssMb)} MB · RSS somado=${Math.round(rssMb)} MB\n`);
    expect(Math.abs(s.memory!.totalMb - pssMb) / pssMb).toBeLessThan(0.15);
    expect(s.memory!.totalMb).toBeLessThan(rssMb * 0.9);
    await app.send({ type: 'memory:toggle', open: false });
  });
});
