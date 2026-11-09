import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW, resolveWindowState } from '../../src/main/window-state';

const screen = [{ x: 0, y: 0, width: 1920, height: 1080 }];

describe('resolveWindowState', () => {
  it('sem estado salvo ou inválido: padrão', () => {
    expect(resolveWindowState(null, screen)).toEqual(DEFAULT_WINDOW);
    expect(resolveWindowState({ width: 'x', height: 5 }, screen)).toEqual(DEFAULT_WINDOW);
    expect(resolveWindowState({ width: 100, height: 100 }, screen)).toEqual(DEFAULT_WINDOW); // pequena demais
  });

  it('restaura posição, tamanho e maximizado', () => {
    expect(resolveWindowState({ x: 100, y: 50, width: 1200, height: 800, maximized: true }, screen))
      .toEqual({ x: 100, y: 50, width: 1200, height: 800, maximized: true });
  });

  it('janela num monitor que não existe mais: mantém tamanho, centraliza', () => {
    expect(resolveWindowState({ x: 3000, y: 100, width: 1200, height: 800, maximized: false }, screen))
      .toEqual({ width: 1200, height: 800, maximized: false });
  });

  it('segundo monitor presente: mantém a posição nele', () => {
    const two = [...screen, { x: 1920, y: 0, width: 2560, height: 1440 }];
    expect(resolveWindowState({ x: 2100, y: 100, width: 1200, height: 800 }, two)).toMatchObject({ x: 2100, y: 100 });
  });
});
