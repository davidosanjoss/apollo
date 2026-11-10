import { describe, expect, it } from 'vitest';
import { DEFAULT_GENERATOR, generatePassword } from '../../src/main/vault/generator';

describe('generatePassword', () => {
  it('tamanho e uma de cada classe pedida', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword({ ...DEFAULT_GENERATOR, length: 12 });
      expect(p).toHaveLength(12);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it('sem símbolos / sem ambíguos', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword({ ...DEFAULT_GENERATOR, symbols: false, length: 32 });
      expect(p).toMatch(/^[A-Za-z0-9]+$/);
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });

  it('limites de tamanho e nenhuma classe escolhida', () => {
    expect(generatePassword({ ...DEFAULT_GENERATOR, length: 2 })).toHaveLength(8);
    expect(generatePassword({ ...DEFAULT_GENERATOR, length: 999 })).toHaveLength(128);
    expect(generatePassword({ length: 10, uppercase: false, lowercase: false, digits: false, symbols: false, avoidAmbiguous: false })).toMatch(/^[a-z]{10}$/);
  });

  it('não se repete e usa o alfabeto todo (sanidade da aleatoriedade)', () => {
    const many = Array.from({ length: 2000 }, () => generatePassword());
    expect(new Set(many).size).toBe(2000);
    const counts = new Map<string, number>();
    for (const c of many.join('')) counts.set(c, (counts.get(c) ?? 0) + 1);
    const values = [...counts.values()];
    expect(counts.size).toBeGreaterThan(60);
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(2.5); // sem caractere muito favorecido
  });
});
