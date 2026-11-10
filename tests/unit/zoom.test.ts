import { describe, expect, it } from 'vitest';
import { nextZoom, zoomKey, zoomPercent } from '../../src/main/zoom';

describe('zoom', () => {
  it('degraus como no Chrome, com limites', () => {
    expect(nextZoom(1, 'in')).toBe(1.1);
    expect(nextZoom(1.1, 'in')).toBe(1.25);
    expect(nextZoom(1, 'out')).toBe(0.9);
    expect(nextZoom(5, 'in')).toBe(5);
    expect(nextZoom(0.25, 'out')).toBe(0.25);
  });
  it('de um fator fora dos degraus vai ao degrau vizinho', () => {
    expect(nextZoom(1.17, 'in')).toBe(1.25);
    expect(nextZoom(1.17, 'out')).toBe(1.1);
  });
  it('chave = host (com porta) só para http(s)', () => {
    expect(zoomKey('https://moodle.ufmg.br/course/view.php?id=1')).toBe('moodle.ufmg.br');
    expect(zoomKey('http://127.0.0.1:8080/x')).toBe('127.0.0.1:8080');
    expect(zoomKey('apollo://home')).toBeNull();
    expect(zoomKey('lixo')).toBeNull();
    expect(zoomPercent(1.1)).toBe(110);
  });
});
