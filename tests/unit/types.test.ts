import { describe, expect, it } from 'vitest';
import { APOLLO_HOME, isHomeUrl } from '../../src/shared/types';

describe('isHomeUrl', () => {
  it('reconhece a página inicial e URL vazia', () => {
    expect(isHomeUrl(APOLLO_HOME)).toBe(true);
    expect(isHomeUrl('apollo://home/index.html')).toBe(true);
    expect(isHomeUrl('')).toBe(true);
    expect(isHomeUrl(null)).toBe(true);
    expect(isHomeUrl(undefined)).toBe(true);
  });

  it('não confunde com outros endereços', () => {
    expect(isHomeUrl('https://home.com')).toBe(false);
    expect(isHomeUrl('apollo://error')).toBe(false);
  });
});
