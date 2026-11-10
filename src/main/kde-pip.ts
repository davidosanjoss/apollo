// Vídeo flutuante sempre por cima no KDE Plasma (Wayland). O Wayland não deixa um app se
// pôr "acima de todas"; só o compositor (KWin) pode. O Apollo carrega um script do KWin,
// pelo D-Bus, que marca "manter acima" SÓ nas janelas de vídeo flutuante do próprio
// processo do Apollo — nenhuma outra janela é tocada. Descarregado ao sair.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** KDE Plasma (no X11 o próprio Chromium já mantém o vídeo por cima). */
export function isKdeWayland(env = process.env, platform = process.platform): boolean {
  return platform === 'linux' && /KDE/i.test(env.XDG_CURRENT_DESKTOP ?? '') && (env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.WAYLAND_DISPLAY));
}

/** Script do KWin (JavaScript do próprio KWin) para as janelas do processo `pid`. */
export function kwinScript(pid: number, above: boolean): string {
  return `// Apollo: vídeo flutuante ${above ? 'sempre por cima' : 'normal'} (processo ${pid}).
const PID = ${Math.trunc(pid)};
const PIP = /picture[\\s-]*in[\\s-]*picture/i;
function apply(w) {
  if (!w || w.pid !== PID || !PIP.test(w.caption)) return;
  w.keepAbove = ${above ? 'true' : 'false'};
}
function watch(w) { apply(w); if (w && w.pid === PID) w.captionChanged.connect(() => apply(w)); }
workspace.windowAdded.connect(watch);
workspace.windowList().forEach(watch);
`;
}

const run = (args: string[]) => new Promise<string>((resolve, reject) =>
  execFile('dbus-send', ['--session', '--print-reply=literal', '--dest=org.kde.KWin', ...args], { timeout: 5000 },
    (err, stdout) => (err ? reject(err) : resolve(stdout))));

export class KdePipKeeper {
  private loaded = false;
  private readonly name = `apollo-pip-${process.pid}`;
  private readonly file = path.join(os.tmpdir(), `${this.name}.js`);

  constructor(private readonly enabled = isKdeWayland()) {}

  /** Carrega (uma vez) o script que mantém o vídeo flutuante por cima. */
  async ensure(above: boolean): Promise<void> {
    if (!this.enabled) return;
    try {
      if (this.loaded) await this.unload();
      fs.writeFileSync(this.file, kwinScript(process.pid, above), { mode: 0o600 });
      const id = (await run(['/Scripting', 'org.kde.kwin.Scripting.loadScript', `string:${this.file}`, `string:${this.name}`])).trim().split(/\s+/).pop();
      if (!id || !/^-?\d+$/.test(id) || Number(id) < 0) throw new Error(`KWin recusou o script (${id})`);
      await run([`/Scripting/Script${id}`, 'org.kde.kwin.Script.run']);
      this.loaded = true;
    } catch (err) {
      console.warn('[apollo] vídeo flutuante por cima (KWin) indisponível:', (err as Error).message);
    }
  }

  async unload(): Promise<void> {
    if (!this.enabled || !this.loaded) return;
    this.loaded = false;
    await run(['/Scripting', 'org.kde.kwin.Scripting.unloadScript', `string:${this.name}`]).catch(() => {});
    fs.rm(this.file, { force: true }, () => {});
  }
}
