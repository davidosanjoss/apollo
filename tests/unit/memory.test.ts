import { describe, expect, it } from 'vitest';
import { memoryBreakdown } from '../../src/main/memory';

const m = (pid: number, mb: number, type = 'Tab') => ({ pid, type, workingSetKb: mb * 1024 });

describe('memoryBreakdown', () => {
  it('soma tudo, separa abas do resto do navegador', () => {
    const r = memoryBreakdown([m(1, 200, 'Browser'), m(2, 150, 'GPU'), m(10, 300), m(11, 100)], [
      { tabId: 'a', pid: 10 }, { tabId: 'b', pid: 11 }, { tabId: 'dormindo', pid: null },
    ]);
    expect(r.totalMb).toBe(750);
    expect(r.otherMb).toBe(350);
    expect(Object.fromEntries(r.perTabMb)).toEqual({ a: 300, b: 100 });
  });

  it('abas no mesmo processo dividem a memória (sem contar duas vezes)', () => {
    const r = memoryBreakdown([m(1, 100, 'Browser'), m(10, 300)], [{ tabId: 'a', pid: 10 }, { tabId: 'b', pid: 10 }, { tabId: 'c', pid: 10 }]);
    expect(Object.fromEntries(r.perTabMb)).toEqual({ a: 100, b: 100, c: 100 });
    expect(r.otherMb).toBe(100);
  });

  it('processo que já sumiu (aba fechando) é ignorado', () => {
    const r = memoryBreakdown([m(1, 100, 'Browser')], [{ tabId: 'a', pid: 99 }]);
    expect(r.perTabMb.size).toBe(0);
    expect(r.otherMb).toBe(100);
  });
});

// Regressão (relatado): o monitor somava o RSS de cada processo e mostrava ~5,5 GB com o
// sistema marcando ~2,8 GB — a memória compartilhada entre os processos do Chromium entrava
// várias vezes. Agora vale o PSS (Linux), que soma certo.
describe('PSS do /proc/<pid>/smaps_rollup', () => {
  it('lê PSS e USS', async () => {
    const { parseSmapsRollup } = await import('../../src/main/memory');
    const text = `55a0c0000000-7ffd0000000 ---p 00000000 00:00 0                          [rollup]
Rss:              412340 kB
Pss:              198765 kB
Pss_Anon:         150000 kB
Shared_Clean:     150000 kB
Private_Clean:     20000 kB
Private_Dirty:    160000 kB
`;
    expect(parseSmapsRollup(text)).toEqual({ pssKb: 198765, ussKb: 180000 });
    expect(parseSmapsRollup('')).toBeNull();
  });
});
