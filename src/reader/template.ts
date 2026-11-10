// Página do modo leitura (puro). O artigo já vem limpo pelo Readability (sem scripts);
// mesmo assim, a página nova proíbe qualquer script (CSP) — só texto, imagens e estilo.

export interface ReaderStyle {
  /** Tamanho do texto em px. */
  size: number;
  font: 'serif' | 'sans';
  theme: 'light' | 'sepia' | 'dark';
}

export const READER_SIZES = [15, 17, 19, 21, 24, 28];
export const DEFAULT_READER_STYLE: ReaderStyle = { size: 19, font: 'serif', theme: 'light' };

export function parseReaderStyle(raw: string | null): ReaderStyle {
  try {
    const v = JSON.parse(raw ?? '') as Partial<ReaderStyle>;
    return {
      size: READER_SIZES.includes(v.size as number) ? v.size as number : DEFAULT_READER_STYLE.size,
      font: v.font === 'sans' ? 'sans' : 'serif',
      theme: v.theme === 'sepia' || v.theme === 'dark' ? v.theme : 'light',
    };
  } catch {
    return { ...DEFAULT_READER_STYLE };
  }
}

/** Próximo tamanho (dir +1/-1), dentro dos limites. */
export function nextReaderSize(size: number, dir: 1 | -1): number {
  const i = READER_SIZES.indexOf(size);
  const at = i < 0 ? READER_SIZES.indexOf(DEFAULT_READER_STYLE.size) : i;
  return READER_SIZES[Math.min(READER_SIZES.length - 1, Math.max(0, at + dir))];
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface Article {
  title: string;
  byline: string | null;
  siteName: string | null;
  /** HTML limpo pelo Readability. */
  content: string;
  /** Tamanho do texto (caracteres). */
  length: number;
  lang: string | null;
}

/** Minutos de leitura (~1000 caracteres por minuto). */
export const readingMinutes = (length: number) => Math.max(1, Math.round(length / 1000));

/** CSS das variáveis de estilo (também usado para trocar o estilo sem refazer a página). */
export function styleVars(s: ReaderStyle): string {
  const theme = { light: ['#ffffff', '#1f1f1f', '#555'], sepia: ['#f4ecd8', '#3b2f1e', '#6b5b45'], dark: ['#1b1b1f', '#e6e6e6', '#9a9a9a'] }[s.theme];
  const font = s.font === 'serif' ? 'Georgia, "Noto Serif", "DejaVu Serif", serif' : 'system-ui, "Noto Sans", "Segoe UI", sans-serif';
  return `:root { --bg: ${theme[0]}; --fg: ${theme[1]}; --muted: ${theme[2]}; --size: ${s.size}px; --font: ${font}; }`;
}

export function readerHtml(a: Article, s: ReaderStyle): string {
  const meta = [a.siteName, a.byline, `${readingMinutes(a.length)} min de leitura`].filter(Boolean).map((x) => escapeHtml(x!)).join(' · ');
  return `<!doctype html>
<html lang="${escapeHtml(a.lang ?? 'pt-BR')}" data-apollo-reader="1">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data: blob:; media-src *; style-src 'unsafe-inline'; font-src *">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(a.title)}</title>
<style id="apollo-reader-vars">${styleVars(s)}</style>
<style>
  html { background: var(--bg); color: var(--fg); }
  body { margin: 0; padding: 48px 20px 96px; font: var(--size)/1.65 var(--font); }
  main { max-width: 38em; margin: 0 auto; }
  h1 { font-size: 1.8em; line-height: 1.2; margin: 0 0 .4em; }
  .meta { color: var(--muted); font-size: .8em; margin-bottom: 2em; font-family: system-ui, sans-serif; }
  img, video, figure { max-width: 100%; height: auto; }
  figure { margin: 1.5em 0; } figcaption { color: var(--muted); font-size: .8em; }
  a { color: inherit; text-decoration-thickness: 1px; }
  pre, code { font-family: ui-monospace, monospace; font-size: .85em; }
  pre { overflow-x: auto; padding: 1em; background: color-mix(in srgb, var(--fg) 8%, transparent); border-radius: 6px; }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid var(--muted); color: var(--muted); }
  table { border-collapse: collapse; } td, th { border: 1px solid var(--muted); padding: 4px 8px; }
</style>
</head>
<body><main id="apollo-reader"><h1>${escapeHtml(a.title)}</h1><div class="meta">${meta}</div>${a.content}</main></body>
</html>`;
}
