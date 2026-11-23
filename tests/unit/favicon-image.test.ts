import { describe, expect, it } from 'vitest';
import { FaviconCache, dataUrlBytes, decodeFavicon } from '../../src/main/favicon-image';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** .ico com as entradas dadas (PNG ou bitmap 32 bits). */
function ico(entries: { size: number; bpp: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + entries.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let off = head.length;
  entries.forEach((e, i) => {
    const p = 6 + i * 16;
    head[p] = e.size % 256;
    head[p + 1] = e.size % 256;
    head.writeUInt16LE(e.bpp, p + 6);
    head.writeUInt32LE(e.data.length, p + 8);
    head.writeUInt32LE(off, p + 12);
    off += e.data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

/** Bitmap 32 bits de lado `n`: linha de baixo vermelha, o resto azul (para conferir a inversão). */
function dib(n: number, alpha = 255): Buffer {
  const h = Buffer.alloc(40);
  h.writeUInt32LE(40, 0);
  h.writeInt32LE(n, 4);
  h.writeInt32LE(n * 2, 8);
  h.writeUInt16LE(1, 12);
  h.writeUInt16LE(32, 14);
  const px = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4; // y = 0 é a linha de baixo
    px.set(y === 0 ? [0, 0, 255, alpha] : [255, 0, 0, alpha], i);
  }
  return Buffer.concat([h, px, Buffer.alloc(n * Math.ceil(n / 32) * 4)]);
}

describe('ícones dos favoritos no menu das pastas', () => {
  it('PNG e JPEG passam direto; SVG e lixo não', () => {
    expect(decodeFavicon(PNG)).toEqual({ kind: 'encoded', data: PNG });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(decodeFavicon(jpeg)?.kind).toBe('encoded');
    expect(decodeFavicon(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(decodeFavicon(Buffer.alloc(0))).toBeNull();
  });

  it('.ico com PNG dentro: usa o PNG', () => {
    expect(decodeFavicon(ico([{ size: 32, bpp: 32, data: PNG }]))).toEqual({ kind: 'encoded', data: PNG });
  });

  it('.ico em bitmap: escolhe o de 32 px e desvira as linhas', () => {
    const d = decodeFavicon(ico([{ size: 16, bpp: 32, data: dib(16) }, { size: 32, bpp: 32, data: dib(32) }, { size: 48, bpp: 32, data: dib(48) }]));
    expect(d).toMatchObject({ kind: 'bgra', width: 32, height: 32 });
    const px = (d as { data: Buffer }).data;
    expect([...px.subarray(0, 4)]).toEqual([255, 0, 0, 255]); // topo azul
    expect([...px.subarray(px.length - 4)]).toEqual([0, 0, 255, 255]); // última linha vermelha
  });

  it('.ico antigo sem alfa fica opaco; bitmap de 8 bits é ignorado', () => {
    const d = decodeFavicon(ico([{ size: 16, bpp: 32, data: dib(16, 0) }]));
    expect((d as { data: Buffer }).data[3]).toBe(255);
    const eight = dib(16);
    eight.writeUInt16LE(8, 14);
    expect(decodeFavicon(ico([{ size: 16, bpp: 8, data: eight }]))).toBeNull();
  });

  it('favicon embutido (data:)', () => {
    expect(dataUrlBytes(`data:image/png;base64,${PNG.toString('base64')}`)).toEqual(PNG);
    expect(dataUrlBytes('https://a.com/x.png')).toBeNull();
  });

  it('cache: baixa uma vez, guarda falhas, não espera além do prazo', async () => {
    const asked: string[] = [];
    const slow = new Promise<Buffer>(() => {});
    const cache = new FaviconCache<string>(async (u) => {
      asked.push(u);
      if (u.includes('lento')) return slow;
      return u.includes('ok') ? PNG : null;
    }, (d) => d.kind);
    const got = await cache.many(['https://a.com/ok.png', 'https://b.com/erro.ico', 'https://c.com/lento.ico', 'https://a.com/ok.png', 'javascript:x'], 100);
    expect([...got]).toEqual([['https://a.com/ok.png', 'encoded']]);
    await cache.many(['https://a.com/ok.png', 'https://b.com/erro.ico'], 100);
    expect(asked).toEqual(['https://a.com/ok.png', 'https://b.com/erro.ico', 'https://c.com/lento.ico']);
    expect([cache.peek('https://a.com/ok.png'), cache.peek('https://b.com/erro.ico'), cache.peek('https://c.com/lento.ico')])
      .toEqual(['encoded', null, undefined]); // baixado, falhou, ainda chegando
  });
});
