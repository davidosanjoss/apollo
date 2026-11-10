import { describe, expect, it } from 'vitest';
import { isKdeWayland, kwinScript } from '../../src/main/kde-pip';

describe('vídeo flutuante por cima (KDE)', () => {
  it('só no KDE com Wayland, no Linux', () => {
    expect(isKdeWayland({ XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland' }, 'linux')).toBe(true);
    expect(isKdeWayland({ XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'x11' }, 'linux')).toBe(false);
    expect(isKdeWayland({ XDG_CURRENT_DESKTOP: 'GNOME', XDG_SESSION_TYPE: 'wayland' }, 'linux')).toBe(false);
    expect(isKdeWayland({ XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland' }, 'win32')).toBe(false);
  });

  it('script mexe só nas janelas de vídeo flutuante do processo do Apollo', () => {
    const js = kwinScript(1234, true);
    expect(js).toContain('const PID = 1234;');
    expect(js).toContain('w.pid !== PID');
    expect(js).toContain('w.keepAbove = true');
    expect(kwinScript(1234, false)).toContain('w.keepAbove = false');
    // O padrão casa com o título da janela do Chromium.
    const re = /picture[\s-]*in[\s-]*picture/i;
    expect(re.test('Picture in picture')).toBe(true);
    expect(re.test('Picture-in-picture')).toBe(true);
    expect(re.test('Moodle — Principal')).toBe(false);
  });
});
