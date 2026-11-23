// Ícones dos sites para os menus nativos (pastas da barra de favoritos). O menu do sistema
// não carrega endereços: o ícone é baixado, decodificado e guardado em memória.
// Esta parte é pura (testável): de bytes do ícone para algo que o nativeImage aceita.

/** PNG/JPEG prontos, ou pixels BGRA (de um .ico em bitmap). */
export type DecodedIcon = { kind: 'encoded'; data: Buffer } | { kind: 'bgra'; data: Buffer; width: number; height: number };

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG);
const isJpeg = (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isIco = (b: Buffer) => b.length >= 6 && b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1 && b.readUInt16LE(4) > 0;

/** Tamanho preferido no menu (16 px; 32 em telas de alta densidade fica nítido ao reduzir). */
const WANT = 32;

/**
 * Bytes de um favicon → imagem que o nativeImage decodifica. PNG e JPEG passam direto;
 * .ico: a entrada mais próxima de 32 px, em PNG ou em bitmap de 32 bits. SVG e o resto: null.
 */
export function decodeFavicon(bytes: Buffer): DecodedIcon | null {
  if (isPng(bytes) || isJpeg(bytes)) return { kind: 'encoded', data: bytes };
  if (!isIco(bytes)) return null;
  const count = bytes.readUInt16LE(4);
  const entries: { size: number; bpp: number; len: number; off: number }[] = [];
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 16;
    if (p + 16 > bytes.length) break;
    entries.push({ size: bytes[p] || 256, bpp: bytes.readUInt16LE(p + 6), len: bytes.readUInt32LE(p + 8), off: bytes.readUInt32LE(p + 12) });
  }
  // O menor que seja >= 32; sem nenhum, o maior. Empate: mais cores.
  entries.sort((a, b) => {
    const ka = a.size >= WANT ? a.size : 10_000 - a.size;
    const kb = b.size >= WANT ? b.size : 10_000 - b.size;
    return ka - kb || b.bpp - a.bpp;
  });
  for (const e of entries) {
    if (e.off + e.len > bytes.length || e.len < 8) continue;
    const img = bytes.subarray(e.off, e.off + e.len);
    if (isPng(img)) return { kind: 'encoded', data: img };
    const dib = dibToBgra(img);
    if (dib) return dib;
  }
  return null;
}

/** Bitmap do .ico (BITMAPINFOHEADER, 32 bits, de baixo para cima) → BGRA de cima para baixo. */
function dibToBgra(dib: Buffer): DecodedIcon | null {
  if (dib.length < 40 || dib.readUInt32LE(0) < 40) return null;
  const header = dib.readUInt32LE(0);
  const width = dib.readInt32LE(4);
  const height = Math.abs(dib.readInt32LE(8)) / 2; // altura conta o XOR e a máscara AND
  const bpp = dib.readUInt16LE(14);
  if (bpp !== 32 || width <= 0 || width > 256 || !Number.isInteger(height) || height <= 0 || height > 256) return null;
  const row = width * 4;
  if (dib.length < header + row * height) return null;
  const out = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) dib.copy(out, y * row, header + (height - 1 - y) * row, header + (height - y) * row);
  // Ícones antigos com alfa todo zerado (a transparência estava só na máscara): opaco.
  let anyAlpha = false;
  for (let i = 3; i < out.length; i += 4) if (out[i]) { anyAlpha = true; break; }
  if (!anyAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { kind: 'bgra', data: out, width, height };
}

/** data:image/...;base64,... → bytes (favicons embutidos na página). */
export function dataUrlBytes(url: string): Buffer | null {
  const m = /^data:[^,;]*(;base64)?,(.*)$/is.exec(url);
  if (!m) return null;
  try { return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]), 'latin1'); } catch { return null; }
}

/**
 * Cache dos ícones já baixados (por endereço do ícone). Um ícone que falhou também fica
 * guardado (null), para não tentar de novo a cada menu.
 */
export class FaviconCache<T> {
  private readonly cache = new Map<string, Promise<T | null>>();
  private readonly done = new Map<string, T | null>();

  constructor(
    private readonly fetchBytes: (url: string) => Promise<Buffer | null>,
    private readonly toImage: (d: DecodedIcon) => T | null,
    private readonly max = 500,
  ) {}

  get(url: string): Promise<T | null> {
    let p = this.cache.get(url);
    if (!p) {
      p = this.load(url).then((img) => { if (this.cache.has(url)) this.done.set(url, img); return img; });
      if (this.cache.size >= this.max) {
        const oldest = this.cache.keys().next().value!;
        this.cache.delete(oldest);
        this.done.delete(oldest);
      }
      this.cache.set(url, p);
    }
    return p;
  }

  /** Já baixado: a imagem (ou null, se falhou). Ainda não: undefined. */
  peek(url: string): T | null | undefined {
    return this.done.get(url);
  }

  /** Os ícones pedidos, esperando no máximo `ms` (o que não chegou fica de fora desta vez). */
  async many(urls: string[], ms: number): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const all = Promise.all([...new Set(urls)].map(async (u) => { const img = await this.get(u); if (img) out.set(u, img); }));
    await Promise.race([all, new Promise((r) => setTimeout(r, ms).unref?.())]);
    return new Map(out);
  }

  private async load(url: string): Promise<T | null> {
    try {
      const bytes = url.startsWith('data:') ? dataUrlBytes(url) : /^https?:\/\//i.test(url) ? await this.fetchBytes(url) : null;
      const d = bytes ? decodeFavicon(bytes) : null;
      return d ? this.toImage(d) : null;
    } catch {
      return null;
    }
  }
}
