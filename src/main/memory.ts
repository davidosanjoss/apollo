// Contabilidade de memória: processos do Electron → abas. Puro e testável.

export interface ProcessMetric {
  pid: number;
  /** Tipo do processo no Chromium: Browser, Tab, GPU, Utility… */
  type: string;
  /**
   * Memória do processo em KB. Linux: PSS (a parte compartilhada é dividida entre os
   * processos, então a soma bate com o uso real); Windows: memória privada. Somar o RSS
   * (workingSetSize) contaria várias vezes o que os processos do Chromium dividem.
   */
  workingSetKb: number;
}

export interface TabProcess {
  tabId: string;
  /** Processo da página; null = aba hibernada/sem página. */
  pid: number | null;
}

export interface MemoryBreakdown {
  totalMb: number;
  /** Navegador, GPU, rede etc. (tudo que não é página de aba). */
  otherMb: number;
  /** Abas sem página não aparecem. Abas que dividem processo dividem a memória. */
  perTabMb: Map<string, number>;
}

const mb = (kb: number) => kb / 1024;

/**
 * /proc/<pid>/smaps_rollup → PSS (proporcional: o compartilhado dividido entre quem usa)
 * e USS (só do processo). null se não der para ler.
 */
export function parseSmapsRollup(text: string): { pssKb: number; ussKb: number } | null {
  const field = (name: string) => {
    const m = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text);
    return m ? Number(m[1]) : null;
  };
  const pss = field('Pss');
  if (pss === null) return null;
  return { pssKb: pss, ussKb: (field('Private_Clean') ?? 0) + (field('Private_Dirty') ?? 0) };
}

export function memoryBreakdown(metrics: ProcessMetric[], tabs: TabProcess[]): MemoryBreakdown {
  const byPid = new Map(metrics.map((m) => [m.pid, m]));
  const totalMb = metrics.reduce((sum, m) => sum + mb(m.workingSetKb), 0);

  const tabsByPid = new Map<number, string[]>();
  for (const t of tabs) {
    if (t.pid === null || !byPid.has(t.pid)) continue;
    tabsByPid.set(t.pid, [...(tabsByPid.get(t.pid) ?? []), t.tabId]);
  }
  const perTabMb = new Map<string, number>();
  let tabsMb = 0;
  for (const [pid, ids] of tabsByPid) {
    const procMb = mb(byPid.get(pid)!.workingSetKb);
    tabsMb += procMb;
    for (const id of ids) perTabMb.set(id, procMb / ids.length);
  }
  return { totalMb, otherMb: totalMb - tabsMb, perTabMb };
}
