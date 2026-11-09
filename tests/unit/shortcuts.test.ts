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
  ])('%o → %s', (input, action) => {
    expect(shortcutFor(input)).toBe(action);
  });

  it('ignora teclas sem modificador, keyUp e Ctrl+Shift+T/W/L', () => {
    expect(shortcutFor(key('t'))).toBeNull();
    expect(shortcutFor({ ...key('t', { control: true }), type: 'keyUp' })).toBeNull();
    expect(shortcutFor(key('t', { control: true, shift: true }))).toBeNull();
    expect(shortcutFor(key('w', { control: true, shift: true }))).toBeNull();
    expect(shortcutFor(key('0', { control: true }))).toBeNull();
    expect(shortcutFor(key('ArrowLeft'))).toBeNull();
  });
});
