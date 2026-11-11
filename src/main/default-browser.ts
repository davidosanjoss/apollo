// Navegador padrão: abrir links vindos de fora (linha de comando / segunda instância) e
// registrar o Apollo no sistema. Linux: entrada .desktop + xdg-settings (KDE, GNOME…).
// Windows: o sistema exige a escolha do usuário em Configurações → Aplicativos padrão.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DESKTOP_FILE = 'apollo.desktop';

/** Link recebido na linha de comando (http/https, ou um arquivo .html/.pdf local). */
export function urlFromArgv(argv: string[], exists: (p: string) => boolean = fs.existsSync): string | null {
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue;
    if (/^https?:\/\//i.test(a)) return a;
    if (/^file:\/\//i.test(a)) return a;
    if (/\.(x?html?|pdf|svg|txt)$/i.test(a) && path.isAbsolute(a) && exists(a)) return pathToFileURL(a).toString();
  }
  return null;
}

/** Como o sistema deve chamar o Apollo (AppImage, instalado, ou em desenvolvimento). */
export function launchCommand(o: { appImage?: string; execPath: string; packaged: boolean; appPath: string }): string {
  const q = (s: string) => `"${s.replace(/(["\\`$])/g, '\\$1')}"`;
  if (o.appImage) return q(o.appImage);
  return o.packaged ? q(o.execPath) : `${q(o.execPath)} ${q(o.appPath)}`;
}

export function desktopEntry(exec: string, icon: string): string {
  return `[Desktop Entry]
Type=Application
Name=Apollo
GenericName=Navegador
Comment=Navegador com workspaces, painéis e privacidade
Exec=${exec} %U
Icon=${icon}
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
StartupWMClass=apollo
StartupNotify=true
`;
}

/**
 * O AppImage mudou de caminho (atualização): a entrada do Apollo no menu (criada pelo botão
 * "navegador padrão") passa a apontar para o arquivo novo. Também conserta, ao abrir, uma
 * entrada que aponta para um AppImage que não existe mais. Devolve true se mudou algo.
 */
export function retargetDesktopEntry(newAppImage: string, oldAppImage: string | null = null, home = os.homedir(),
  exists: (p: string) => boolean = fs.existsSync): boolean {
  const file = path.join(home, '.local/share/applications', DESKTOP_FILE);
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const m = /^Exec="([^"]+\.AppImage)"(.*)$/m.exec(text);
  if (!m) return false; // não é a entrada de um AppImage (ex.: instalado pelo AUR)
  const current = m[1].replace(/\\(["\\`$])/g, '$1');
  const stale = oldAppImage ? current === oldAppImage : !exists(current);
  if (!stale || current === newAppImage) return false;
  fs.writeFileSync(file, text.replace(m[0], `Exec=${launchCommand({ appImage: newAppImage, execPath: '', packaged: true, appPath: '' })}${m[2]}`));
  return true;
}

const run = (cmd: string, args: string[]) => new Promise<string>((resolve, reject) =>
  execFile(cmd, args, { timeout: 8000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))));

export async function isDefaultBrowser(platform = process.platform): Promise<boolean | null> {
  if (platform !== 'linux') return null; // Windows: não dá para consultar de forma confiável
  try {
    return ['apollo.desktop', 'apollo-browser.desktop'].includes(await run('xdg-settings', ['get', 'default-web-browser']));
  } catch { return null; }
}

/**
 * Linux: instala a entrada (e o ícone) do usuário e torna o Apollo o padrão. Com
 * `desktopFile` (instalado por um pacote), só escolhe essa entrada.
 */
export async function makeDefaultLinux(o: { exec: string; iconSvg: string | null; home?: string; desktopFile?: string }): Promise<void> {
  if (o.desktopFile) {
    await run('xdg-settings', ['set', 'default-web-browser', o.desktopFile]);
    await run('xdg-mime', ['default', o.desktopFile, 'x-scheme-handler/http', 'x-scheme-handler/https', 'text/html', 'application/xhtml+xml']).catch(() => {});
    return;
  }
  const home = o.home ?? os.homedir();
  const apps = path.join(home, '.local/share/applications');
  fs.mkdirSync(apps, { recursive: true });
  let icon = 'web-browser';
  if (o.iconSvg) {
    const dir = path.join(home, '.local/share/icons/hicolor/scalable/apps');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'apollo.svg'), o.iconSvg);
    icon = 'apollo';
  }
  fs.writeFileSync(path.join(apps, DESKTOP_FILE), desktopEntry(o.exec, icon));
  await run('update-desktop-database', [apps]).catch(() => {}); // nem toda distro tem
  await run('xdg-settings', ['set', 'default-web-browser', DESKTOP_FILE]);
  await run('xdg-mime', ['default', DESKTOP_FILE, 'x-scheme-handler/http', 'x-scheme-handler/https', 'text/html', 'application/xhtml+xml']).catch(() => {});
}
