import { describe, expect, it } from 'vitest';
import { compareVersions, parseNotes } from '../../src/shared/release-notes';

describe('comparar versões', () => {
  it('numérico (0.10 > 0.9), com ou sem "v"', () => {
    expect(compareVersions('v0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.7.0', 'v0.7.0')).toBe(0);
    expect(compareVersions('0.6.1', '0.7')).toBe(-1);
  });
  it('pré-versão é menor que a final', () => {
    expect(compareVersions('0.7.0-beta.1', '0.7.0')).toBe(-1);
    expect(compareVersions('0.7.0', '0.7.0-beta.1')).toBe(1);
    expect(compareVersions('0.7.0-beta.2', '0.7.0-beta.1')).toBe(1);
  });
});

describe('notas de versão', () => {
  it('títulos, itens (com continuação) e texto; sem marcação', () => {
    expect(parseNotes('### Adicionado\n- **Favoritos** com `pastas`\n  e subpastas\n\nVeja [o site](https://x.com).\n'))
      .toEqual([
        { type: 'heading', text: 'Adicionado' },
        { type: 'item', text: 'Favoritos com pastas e subpastas' },
        { type: 'text', text: 'Veja o site.' },
      ]);
  });
  it('HTML e imagens somem (a interface só mostra texto)', () => {
    expect(parseNotes('- <img src=x onerror=alert(1)>Oi ![a](b.png)')).toEqual([{ type: 'item', text: 'Oi' }]);
    expect(parseNotes('- <script>alert(1)</script>Vídeo <style>b{}</style>ok')).toEqual([{ type: 'item', text: 'Vídeo ok' }]);
  });
});
