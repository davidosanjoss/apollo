import { describe, expect, it } from 'vitest';
import { clampRatio, parseSplits, partnerOf, SPLIT_ACTIVE_BAR, SPLIT_GAP, splitBounds } from '../../src/main/split';

const area = { x: 100, y: 50, width: 1006, height: 800 };
const s = { a: 'esq', b: 'dir', ratio: 0.5 };

describe('tela dividida', () => {
  it('metades com a divisória no meio; a ativa deixa a faixa do topo', () => {
    const b = splitBounds(area, s, 'esq');
    expect(b.a).toEqual({ x: 100, y: 50 + SPLIT_ACTIVE_BAR, width: 500, height: 800 - SPLIT_ACTIVE_BAR });
    expect(b.b).toEqual({ x: 100 + 500 + SPLIT_GAP, y: 50, width: 500, height: 800 });
  });

  it('proporção respeitada e limitada (15–85%)', () => {
    expect(splitBounds(area, { ...s, ratio: 0.3 }, 'dir').a.width).toBe(300);
    expect(clampRatio(0.99)).toBe(0.85);
    expect(clampRatio(Number.NaN)).toBe(0.5);
  });

  it('par e estado salvo (inválidos ficam de fora)', () => {
    expect(partnerOf(s, 'esq')).toBe('dir');
    expect(partnerOf(s, 'outra')).toBeNull();
    expect(partnerOf(undefined, 'esq')).toBeNull();
    expect(parseSplits('{"w":{"a":"x","b":"y","ratio":2},"v":{"a":"z","b":"z"},"u":null}')).toEqual({ w: { a: 'x', b: 'y', ratio: 0.85 } });
    expect(parseSplits('lixo')).toEqual({});
  });
});
