// Zoom por site (puro): degraus como os do Chrome e a chave do site.

/** Degraus de zoom (fator). 1 = 100%. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

/** Próximo degrau na direção pedida (de um fator qualquer, ex.: vindo da roda do mouse). */
export function nextZoom(factor: number, dir: 'in' | 'out'): number {
  const eps = 0.001;
  if (dir === 'in') return ZOOM_STEPS.find((z) => z > factor + eps) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < factor - eps) ?? ZOOM_STEPS[0];
}

/** Site para guardar o zoom: o host (com porta) de páginas http(s); outras não guardam. */
export function zoomKey(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.host : null;
  } catch {
    return null;
  }
}

export const zoomPercent = (factor: number) => Math.round(factor * 100);
