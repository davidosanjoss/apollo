// Árvore de favoritos (puro): filhos, caminho da pasta, opções de pasta e onde soltar.
import type { BookmarkInfo } from '../shared/types';

export const childrenOf = (list: BookmarkInfo[], parentId: string | null) => list.filter((b) => b.parentId === parentId);

/** Nomes das pastas acima do item, da raiz para baixo. */
export function folderPath(list: BookmarkInfo[], id: string): string[] {
  const byId = new Map(list.map((b) => [b.id, b]));
  const out: string[] = [];
  for (let cur = byId.get(id)?.parentId ?? null, guard = 0; cur && guard < 64; cur = byId.get(cur)?.parentId ?? null, guard++) {
    const f = byId.get(cur);
    if (!f) break;
    out.unshift(f.title);
  }
  return out;
}

/** `id` é `folderId` ou está acima dele? (uma pasta não entra nela mesma nem numa subpasta) */
export function isInside(list: BookmarkInfo[], folderId: string | null, id: string): boolean {
  const byId = new Map(list.map((b) => [b.id, b]));
  for (let cur = folderId, guard = 0; cur && guard < 64; cur = byId.get(cur)?.parentId ?? null, guard++) if (cur === id) return true;
  return false;
}

/** Pastas para o seletor "Pasta" (com recuo), menos `exclude` e o que tem dentro dela. */
export function folderOptions(list: BookmarkInfo[], exclude: string | null = null): { id: string | null; label: string }[] {
  const out: { id: string | null; label: string }[] = [{ id: null, label: 'Barra de favoritos' }];
  const walk = (parent: string | null, depth: number) => {
    for (const f of childrenOf(list, parent).filter((b) => b.folder && b.id !== exclude)) {
      out.push({ id: f.id, label: `${'   '.repeat(depth + 1)}📁 ${f.title}` });
      if (depth < 32) walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export type DropPlace = 'before' | 'after' | 'into';

/**
 * Resultado de soltar `dragged` em `target` (antes/depois dele, ou dentro, se for pasta):
 * a pasta de destino e a posição final entre os filhos dela. null = soltura inválida.
 */
export function dropTarget(list: BookmarkInfo[], dragged: string, target: string, place: DropPlace):
  { parentId: string | null; index: number } | null {
  const t = list.find((b) => b.id === target);
  if (!t || dragged === target) return null;
  if (place === 'into') {
    if (!t.folder || isInside(list, t.id, dragged)) return null;
    return { parentId: t.id, index: childrenOf(list, t.id).filter((b) => b.id !== dragged).length };
  }
  if (isInside(list, t.parentId, dragged)) return null;
  const siblings = childrenOf(list, t.parentId).filter((b) => b.id !== dragged);
  const i = siblings.findIndex((b) => b.id === target);
  return { parentId: t.parentId, index: place === 'after' ? i + 1 : i };
}

/** Onde soltar pela posição do cursor: pasta tem o meio como "dentro". */
export function dropPlace(folder: boolean, ratio: number): DropPlace {
  if (folder && ratio > 0.25 && ratio < 0.75) return 'into';
  return ratio < 0.5 ? 'before' : 'after';
}
