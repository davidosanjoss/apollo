// Quais abas hibernar (liberar a página da memória, mantendo URL e histórico).
// Puro e testável: o Browser coleta os fatos e aplica a decisão.

export interface HibernationCandidate {
  id: string;
  workspaceId: string;
  /** Tem página carregada (só essas ocupam memória). */
  alive: boolean;
  /** É a aba que está na tela agora. */
  visible: boolean;
  /** Marcada pelo usuário como "manter sempre ativa". */
  keepAwake: boolean;
  /** Tocando som ou vídeo/áudio em reprodução (chamadas, música, aula). */
  playingMedia: boolean;
  /** A página recusou sair (beforeunload: formulário não enviado). */
  unloadBlocked: boolean;
  /** Momento (ms) em que deixou de estar na tela pela última vez. */
  lastSeenAt: number;
  /** Memória estimada da aba em MB (null = desconhecida). */
  memoryMb: number | null;
}

export interface HibernationPolicy {
  /** Minutos sem uso para hibernar, por workspace (0 = nunca). */
  timeoutMin: (workspaceId: string) => number;
  /** Limite de memória total do Apollo em MB (null = sem limite). */
  memoryLimitMb: number | null;
  /** Memória total atual do Apollo em MB. */
  memoryUsedMb: number;
}

/** Fixadas não são exceção: hibernam como as outras se nada abaixo as segurar. */
export function canHibernate(t: HibernationCandidate): boolean {
  return t.alive && !t.visible && !t.keepAwake && !t.playingMedia && !t.unloadBlocked;
}

export function pickTabsToHibernate(tabs: HibernationCandidate[], policy: HibernationPolicy, now: number, minuteMs = 60_000): string[] {
  const eligible = tabs.filter(canHibernate);
  const picked = new Set<string>();

  // 1. Tempo sem uso (por workspace).
  for (const t of eligible) {
    const minutes = policy.timeoutMin(t.workspaceId);
    if (minutes > 0 && now - t.lastSeenAt >= minutes * minuteMs) picked.add(t.id);
  }

  // 2. Limite de memória: hiberna as menos usadas recentemente até caber.
  if (policy.memoryLimitMb !== null && policy.memoryUsedMb > policy.memoryLimitMb) {
    let used = policy.memoryUsedMb;
    for (const t of eligible) if (picked.has(t.id)) used -= t.memoryMb ?? 0;
    const rest = eligible.filter((t) => !picked.has(t.id)).sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    for (const t of rest) {
      if (used <= policy.memoryLimitMb) break;
      picked.add(t.id);
      // Sem estimativa, libera uma por rodada (a próxima medição diz se precisa mais).
      if (t.memoryMb === null) break;
      used -= t.memoryMb;
    }
  }
  return [...picked];
}
