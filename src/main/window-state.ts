// Tamanho/posição da janela entre execuções.
export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Rect { x: number; y: number; width: number; height: number }

export const DEFAULT_WINDOW: WindowState = { width: 1400, height: 900, maximized: false };

/**
 * Valida o estado salvo contra as telas atuais. Se a janela ficaria fora de
 * qualquer tela (monitor desconectado), abre no tamanho salvo, centralizada.
 */
export function resolveWindowState(saved: unknown, displays: Rect[]): WindowState {
  const s = saved as Partial<WindowState> | null;
  const ok = (n: unknown, min = -100_000) => typeof n === 'number' && Number.isFinite(n) && n >= min && n < 100_000;
  if (!s || !ok(s.width, 400) || !ok(s.height, 300)) return DEFAULT_WINDOW;
  const base: WindowState = { width: Math.round(s.width!), height: Math.round(s.height!), maximized: s.maximized === true };
  if (!ok(s.x) || !ok(s.y)) return base;

  // Precisa sobrar um pedaço visível razoável (barra de título) em alguma tela.
  const visible = displays.some((d) =>
    s.x! + base.width - 100 > d.x && s.x! + 100 < d.x + d.width && s.y! >= d.y - 10 && s.y! + 50 < d.y + d.height);
  return visible ? { ...base, x: Math.round(s.x!), y: Math.round(s.y!) } : base;
}
