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
