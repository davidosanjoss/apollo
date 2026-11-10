import { describe, expect, it } from 'vitest';
import { shortcutFor, type KeyInput } from '../../src/main/shortcuts';

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput =>
  ({ type: 'keyDown', key: k, control: false, meta: false, shift: false, alt: false, ...mods });

describe('shortcutFor', () => {
  it.each([
    [key('t', { control: true }), 'new-tab'],
    [key('T', { control: true }), 'new-tab'],
    [key('w', { control: true }), 'close-tab'],
    [key('l', { control: true }), 'focus-address'],
    [key('r', { control: true }), 'reload'],
    [key('F5'), 'reload'],
    [key('Tab', { control: true }), 'next-tab'],
    [key('Tab', { control: true, shift: true }), 'prev-tab'],
    [key('ArrowLeft', { alt: true }), 'back'],
    [key('ArrowRight', { alt: true }), 'forward'],
    [key('1', { control: true }), 'workspace-1'],
    [key('9', { control: true }), 'workspace-9'],
    [key('t', { meta: true }), 'new-tab'],
    [key('T', { control: true, shift: true }), 'reopen-tab'],
    [key('Escape', { shift: true }), 'memory-monitor'],
    [key('L', { control: true, shift: true }), 'autofill'],
    [key('k', { control: true }), 'palette'],
    [key('d', { control: true }), 'bookmark'],
    [key('f', { control: true }), 'find'],
    [key('p', { control: true }), 'print'],
    [key('F11'), 'fullscreen'],
    [key('F12'), 'devtools'],
    [key('I', { control: true, shift: true }), 'devtools'],
    [key('=', { control: true }), 'zoom-in'],
    [key('+', { control: true, shift: true }), 'zoom-in'],
    [key('-', { control: true }), 'zoom-out'],
    [key('0', { control: true }), 'zoom-reset'],
    [key('F3'), 'find-next'],
    [key('F3', { shift: true }), 'find-prev'],
    [key('g', { control: true }), 'find-next'],
    [key('G', { control: true, shift: true }), 'find-prev'],
  ])('%o → %s', (input, action) => {
    expect(shortcutFor(input)).toBe(action);
  });

  it('ignora teclas sem modificador, keyUp e Ctrl+Shift+W', () => {
    expect(shortcutFor(key('t'))).toBeNull();
    expect(shortcutFor({ ...key('t', { control: true }), type: 'keyUp' })).toBeNull();
    expect(shortcutFor(key('w', { control: true, shift: true }))).toBeNull();
    expect(shortcutFor(key('0', { control: true, alt: true }))).toBeNull(); // Ctrl+0 sozinho = zoom 100%
    expect(shortcutFor(key('ArrowLeft'))).toBeNull();
    expect(shortcutFor(key('Escape'))).toBeNull(); // Esc sozinho é das páginas
    expect(shortcutFor(key('Escape', { shift: true, control: true }))).toBeNull();
  });
});
