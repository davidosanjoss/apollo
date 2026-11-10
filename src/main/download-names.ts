// Nome de arquivo único na pasta de downloads (puro): "nota.pdf" → "nota (1).pdf".

/** Separa "arquivo.tar.gz" em ["arquivo", ".tar.gz"] (extensões duplas comuns). */
function splitExt(name: string): [string, string] {
  const double = /\.(tar\.(gz|bz2|xz|zst))$/i.exec(name);
  if (double) return [name.slice(0, double.index), name.slice(double.index)];
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

/** Nome seguro: sem separadores de pasta nem caracteres proibidos (Windows), nunca vazio. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 200);
  return clean || 'download';
}

export function uniqueName(name: string, taken: (candidate: string) => boolean): string {
  const safe = safeFileName(name);
  if (!taken(safe)) return safe;
  const [base, ext] = splitExt(safe);
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}
