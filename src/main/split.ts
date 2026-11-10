// Tela dividida (puro): par de abas por workspace e a geometria das duas metades.

export interface Split {
  /** Aba da esquerda / da direita. */
  a: string;
  b: string;
  /** Fração da largura da esquerda (0,15–0,85). */
  ratio: number;
}

export const SPLIT_GAP = 6; // divisória desenhada pela interface
export const SPLIT_ACTIVE_BAR = 3; // faixa no topo da metade ativa
export const clampRatio = (r: number) => Math.min(0.85, Math.max(0.15, Number.isFinite(r) ? r : 0.5));

export const partnerOf = (s: Split | undefined, tabId: string): string | null =>
  !s ? null : s.a === tabId ? s.b : s.b === tabId ? s.a : null;

interface Rect { x: number; y: number; width: number; height: number }

/** Limites das metades dentro da área das páginas; a ativa deixa a faixa do topo à mostra. */
export function splitBounds(area: Rect, s: Split, activeId: string): { a: Rect; b: Rect } {
  const usable = Math.max(0, area.width - SPLIT_GAP);
  const wa = Math.round(usable * clampRatio(s.ratio));
  const top = (id: string) => (id === activeId ? SPLIT_ACTIVE_BAR : 0);
  return {
    a: { x: area.x, y: area.y + top(s.a), width: wa, height: Math.max(0, area.height - top(s.a)) },
    b: { x: area.x + wa + SPLIT_GAP, y: area.y + top(s.b), width: usable - wa, height: Math.max(0, area.height - top(s.b)) },
  };
}

export function parseSplits(raw: string | null): Record<string, Split> {
  try {
    const v = JSON.parse(raw ?? '{}') as Record<string, Split>;
    const out: Record<string, Split> = {};
    for (const [ws, s] of Object.entries(v)) {
      if (s && typeof s.a === 'string' && typeof s.b === 'string' && s.a !== s.b) out[ws] = { a: s.a, b: s.b, ratio: clampRatio(s.ratio) };
    }
    return out;
  } catch {
    return {};
  }
}
