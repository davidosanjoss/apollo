// Vídeo flutuante sempre por cima no KDE Wayland (script do KWin). Só roda numa janela
// real num KDE (APOLLO_E2E_SHOW=1); no CI e em outros ambientes é pulado.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isKdeWayland } from '../../src/main/kde-pip';
import { Apollo, startSite, tempProfile } from './harness';

const dbus = (...args: string[]) => execFileSync('dbus-send', ['--session', '--print-reply=literal', '--dest=org.kde.KWin', ...args]).toString().trim();

/** Janelas de vídeo flutuante do processo `pid`, lidas pelo próprio KWin. */
function pipWindows(pid: number): { above: boolean }[] {
  const tag = `APOLLOTEST${Date.now()}`;
  const file = path.join(os.tmpdir(), `${tag}.js`);
  fs.writeFileSync(file, `print("${tag} " + JSON.stringify(workspace.windowList().filter((w) => w.pid === ${pid} && /picture[\\s-]*in[\\s-]*picture/i.test(w.caption)).map((w) => ({ above: w.keepAbove }))));`);
  const id = dbus('/Scripting', 'org.kde.kwin.Scripting.loadScript', `string:${file}`, `string:${tag}`).split(/\s+/).pop();
  dbus(`/Scripting/Script${id}`, 'org.kde.kwin.Script.run');
  execFileSync('sleep', ['0.8']);
  dbus('/Scripting', 'org.kde.kwin.Scripting.unloadScript', `string:${tag}`);
  fs.rmSync(file, { force: true });
  const line = execFileSync('journalctl', ['--user', '-b', '--since', '-1min', '-o', 'cat']).toString().split('\n').filter((l) => l.startsWith(tag)).pop();
  return line ? JSON.parse(line.slice(tag.length + 1)) : [];
}

describe.skipIf(!(process.env.APOLLO_E2E_SHOW && isKdeWayland()))('vídeo flutuante por cima (KDE)', () => {
  it('a janela do vídeo flutuante fica "manter acima"; o script sai junto com o Apollo', async () => {
    const site = await startSite();
    const profile = tempProfile();
    const app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1' });
    const main = await app.main();
    const pid = await main.eval<number>('process.pid');
    try {
      await app.send({ type: 'tab:navigate', url: `${site.url}/video` });
      await app.until((s) => s.pip.available, 'vídeo');
      await app.send({ type: 'tab:pip' });
      await app.until((s) => s.pip.active, 'flutuando');
      await new Promise((r) => setTimeout(r, 1500));
      expect(pipWindows(pid)).toEqual([{ above: true }]);
      expect(dbus('/Scripting', 'org.kde.kwin.Scripting.isScriptLoaded', `string:apollo-pip-${pid}`)).toContain('true');
    } finally {
      await app.quit();
      await site.close();
      profile.cleanup();
    }
    expect(dbus('/Scripting', 'org.kde.kwin.Scripting.isScriptLoaded', `string:apollo-pip-${pid}`)).toContain('false');
  });
});
