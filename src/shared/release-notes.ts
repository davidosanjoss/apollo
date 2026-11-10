// Versões e notas de versão (puro). As notas vêm do CHANGELOG (markdown simples) e
// viram blocos de texto: a interface desenha com textContent, nunca como HTML.

/** -1, 0 ou 1. Aceita "v0.7.0", "0.7.0", "0.7.0-beta.1" (pré-versão < versão final). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, pre] = v.trim().replace(/^v/i, '').split('-', 2);
    return { nums: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre > y.pre ? 1 : -1;
}

export type NoteBlock = { type: 'heading' | 'item' | 'text'; text: string };

const MAX_BLOCKS = 200;
const MAX_TEXT = 2000;

/** Tira a marcação inline (negrito, código, links) e deixa o texto. */
function plain(s: string): string {
  return s
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '') // blocos inteiros, não só as tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // imagens
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → texto
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
    .slice(0, MAX_TEXT);
}

export function parseNotes(md: string): NoteBlock[] {
  const out: NoteBlock[] = [];
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) out.push({ type: 'heading', text: plain(m[1]) });
    else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) out.push({ type: 'item', text: plain(m[1]) });
    else if (/^\s{2,}\S/.test(line) && out.at(-1)?.type === 'item') out[out.length - 1].text += ` ${plain(line)}`; // continuação do item
    else out.push({ type: 'text', text: plain(line) });
    if (out.length >= MAX_BLOCKS) break;
  }
  return out.filter((b) => b.text);
}
