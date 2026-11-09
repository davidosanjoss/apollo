// Montagem da barra de abas e cálculo do "soltar" do arrastar — puro, testável.
import type { GroupInfo, TabInfo } from '../shared/types';

export type StripItem =
  | { kind: 'group'; key: string; group: GroupInfo; count: number }
  | { kind: 'tab'; key: string; tab: TabInfo; group: GroupInfo | null; hidden: boolean };

/** Chip do grupo antes do primeiro membro; abas de grupo recolhido somem (menos a ativa). */
export function buildStrip(tabs: TabInfo[], groups: GroupInfo[], activeTabId: string | null): StripItem[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const items: StripItem[] = [];
  let lastGroup: string | null = null;
  for (const tab of tabs) {
    const group = (tab.groupId && byId.get(tab.groupId)) || null;
    if (group && group.id !== lastGroup) {
      items.push({ kind: 'group', key: `g:${group.id}`, group, count: tabs.filter((t) => t.groupId === group.id).length });
    }
    lastGroup = group?.id ?? null;
    items.push({ kind: 'tab', key: `t:${tab.id}`, tab, group, hidden: Boolean(group?.collapsed) && tab.id !== activeTabId });
  }
  return items;
}

export type DropTarget =
  | { kind: 'tab'; id: string; after: boolean }
  | { kind: 'group'; id: string }
  | { kind: 'end' };

/** Converte onde a aba foi solta no comando tab:move (índice final + grupo). */
export function computeDrop(tabs: TabInfo[], draggedId: string, target: DropTarget): { index: number; groupId: string | null | undefined } | null {
  const dragged = tabs.find((t) => t.id === draggedId);
  if (!dragged) return null;
  const rest = tabs.filter((t) => t.id !== draggedId);
  switch (target.kind) {
    case 'end':
      return { index: rest.length, groupId: dragged.pinned ? undefined : null };
    case 'group': {
      const first = rest.findIndex((t) => t.groupId === target.id);
      if (first < 0) return null;
      return { index: first, groupId: target.id };
    }
    case 'tab': {
      if (target.id === draggedId) return null;
      const i = rest.findIndex((t) => t.id === target.id);
      if (i < 0) return null;
      const over = rest[i];
      // Fixadas não têm grupo; soltar sobre fixada mantém a aba como está.
      return { index: i + (target.after ? 1 : 0), groupId: over.pinned || dragged.pinned ? undefined : over.groupId };
    }
  }
}
