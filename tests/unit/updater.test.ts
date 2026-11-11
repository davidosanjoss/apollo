import { describe, expect, it } from 'vitest';
import { cleanAppImageEnv } from '../../src/main/updater';

// Regressão (relatado): depois de "instalar e reiniciar", o Apollo novo não abria. Num teste
// real, ele abria e caía na hora ("Zygote process exited prematurely") por herdar o
// CHROME_DESKTOP do antigo; variáveis apontando para a montagem antiga também atrapalham.
describe('ambiente do Apollo reaberto depois de atualizar o AppImage', () => {
  const mount = '/tmp/.mount_Apollo123';
  const env = {
    HOME: '/home/u', DISPLAY: ':0', APPDIR: mount, APPIMAGE: '/u/Apollo-0.9.0.AppImage', OWD: '/u', ARGV0: 'apollo',
    CHROME_DESKTOP: 'apollo.desktop', EGL_PLATFORM: 'wayland', FC_FONTATIONS: '1', NO_AT_BRIDGE: '1',
    PATH: `${mount}/usr/bin:/usr/local/bin:/usr/bin`, LD_LIBRARY_PATH: `${mount}/usr/lib`, GSETTINGS_SCHEMA_DIR: `${mount}/usr/share/glib-2.0/schemas`,
  };

  it('tira as variáveis do AppImage e do Chromium; limpa só os trechos da montagem antiga', () => {
    const clean = cleanAppImageEnv(env);
    expect(clean).toEqual({ HOME: '/home/u', DISPLAY: ':0', PATH: '/usr/local/bin:/usr/bin' });
  });

  it('fora de um AppImage (sem APPDIR) só tira as variáveis conhecidas', () => {
    expect(cleanAppImageEnv({ HOME: '/h', PATH: '/usr/bin', CHROME_DESKTOP: 'x' })).toEqual({ HOME: '/h', PATH: '/usr/bin' });
  });
});
