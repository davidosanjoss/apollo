// Regras de ordem das abas de um workspace, como funções puras:
//   1. Fixadas vêm primeiro e nunca pertencem a um grupo.
//   2. As abas de um grupo ficam sempre juntas (o bloco fica onde está o primeiro membro).
// O Store só grava o resultado (posição, fixada, grupo).

export interface OrderTab {
  id: string;
  pinned: boolean;
  groupId: string | null;
}

/** Impõe as regras mantendo a ordem relativa o máximo possível. */
export function normalize<T extends OrderTab>(tabs: T[]): T[] {
  const pinned = tabs.filter((t) => t.pinned).map((t) => (t.groupId ? { ...t, groupId: null } : t));
  const rest = tabs.filter((t) => !t.pinned);
  const out: T[] = [];
  const placed = new Set<string>();
  for (const t of rest) {
    if (!t.groupId) { out.push(t); continue; }
    if (placed.has(t.groupId)) continue;
    placed.add(t.groupId);
    out.push(...rest.filter((x) => x.groupId === t.groupId));
  }
  return [...pinned, ...out];
}

const pinnedCount = (tabs: OrderTab[]) => tabs.filter((t) => t.pinned).length;

/**
 * Arrastar: move a aba para `toIndex` (índice final desejado). `groupId` define o
 * grupo de destino (undefined = mantém o atual). Fixadas só se movem entre fixadas.
 */
export function moveTab<T extends OrderTab>(tabs: T[], id: string, toIndex: number, groupId?: string | null): T[] {
  const from = tabs.findIndex((t) => t.id === id);
  if (from < 0) return tabs;
  const moving = { ...tabs[from], ...(groupId !== undefined && !tabs[from].pinned ? { groupId } : {}) };
  const rest = tabs.filter((t) => t.id !== id);
  const pins = pinnedCount(rest);
  const index = moving.pinned
    ? Math.min(Math.max(0, toIndex), pins)
    : Math.min(Math.max(pins, toIndex), rest.length);
  rest.splice(index, 0, moving);
  return groupAround(rest, moving.id);
}

/**
 * Depois de inserir uma aba numa posição, junta os grupos: se ela ficou no meio de
 * um grupo que não é o dela, ela sai para depois do bloco desse grupo.
 */
function groupAround<T extends OrderTab>(tabs: T[], id: string): T[] {
  const i = tabs.findIndex((t) => t.id === id);
  const me = tabs[i];
  const before = tabs[i - 1];
  const after = tabs[i + 1];
  if (before && after && before.groupId && before.groupId === after.groupId && me.groupId !== before.groupId) {
    const g = before.groupId;
    const without = tabs.filter((t) => t.id !== id);
    let last = -1;
    without.forEach((t, k) => { if (t.groupId === g) last = k; });
    without.splice(last + 1, 0, me);
    return normalize(without);
  }
  return normalize(tabs);
}

/** Fixar vai para o fim das fixadas; desafixar vai para o começo das não fixadas. */
export function setPinned<T extends OrderTab>(tabs: T[], id: string, pinned: boolean): T[] {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || tab.pinned === pinned) return tabs;
  const rest = tabs.filter((t) => t.id !== id);
  const changed = { ...tab, pinned, groupId: null };
  rest.splice(pinnedCount(rest), 0, changed);
  return normalize(rest);
}

/**
 * Coloca a aba num grupo (no fim do bloco dele) ou tira do grupo (logo depois do
 * bloco de onde saiu). Fixada que entra num grupo deixa de ser fixada.
 */
export function setGroup<T extends OrderTab>(tabs: T[], id: string, groupId: string | null): T[] {
  const tab = tabs.find((t) => t.id === id);
  if (!tab || (tab.groupId === groupId && !tab.pinned)) return tabs;
  const anchorGroup = groupId ?? tab.groupId;
  const rest = tabs.filter((t) => t.id !== id);
  const changed = { ...tab, pinned: groupId ? false : tab.pinned, groupId };
  let last = -1;
  rest.forEach((t, k) => { if (anchorGroup && t.groupId === anchorGroup) last = k; });
  if (last >= 0) rest.splice(last + 1, 0, changed);
  else rest.splice(Math.min(tabs.findIndex((t) => t.id === id), rest.length), 0, changed);
  return normalize(rest);
}

/**
 * Coloca a aba num grupo SEM movê-la (ela já foi inserida ao lado de um membro,
 * ex.: nova aba aberta a partir de uma aba do grupo, ou duplicada).
 */
export function joinGroupInPlace<T extends OrderTab>(tabs: T[], id: string, groupId: string): T[] {
  return normalize(tabs.map((t) => (t.id === id ? { ...t, pinned: false, groupId } : t)));
}
