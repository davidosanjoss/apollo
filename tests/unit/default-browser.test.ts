import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { desktopEntry, launchCommand, retargetDesktopEntry, urlFromArgv } from '../../src/main/default-browser';

describe('navegador padrão', () => {
  it('link da linha de comando: http(s), file:// e arquivo local; ignora opções', () => {
    expect(urlFromArgv(['apollo', '--no-sandbox', 'https://moodle.ufmg.br/x?y=1'])).toBe('https://moodle.ufmg.br/x?y=1');
    expect(urlFromArgv(['/usr/bin/electron', '/app', 'http://a.com'])).toBe('http://a.com');
    // Regressão (CI no Windows): lá o caminho ganha a letra do disco (file:///D:/tmp/…).
    expect(urlFromArgv(['apollo', '/tmp/nao.html'], () => true)).toBe(pathToFileURL('/tmp/nao.html').toString());
    expect(urlFromArgv(['apollo', '/tmp/nao-existe.html'], () => false)).toBeNull();
    expect(urlFromArgv(['apollo', 'javascript:alert(1)'])).toBeNull();
    expect(urlFromArgv(['apollo'])).toBeNull();
  });

  it('comando: AppImage, instalado ou desenvolvimento (com aspas seguras)', () => {
    expect(launchCommand({ appImage: '/home/u/Apps/Apollo.AppImage', execPath: '/x', packaged: true, appPath: '/a' })).toBe('"/home/u/Apps/Apollo.AppImage"');
    expect(launchCommand({ execPath: '/opt/Apollo/apollo', packaged: true, appPath: '/a' })).toBe('"/opt/Apollo/apollo"');
    expect(launchCommand({ execPath: '/e/electron', packaged: false, appPath: '/src/apollo' })).toBe('"/e/electron" "/src/apollo"');
    expect(launchCommand({ execPath: '/a"b$c', packaged: true, appPath: '' })).toBe('"/a\\"b\\$c"');
  });

  it('entrada .desktop declara http, https e html', () => {
    const d = desktopEntry('"/x/Apollo.AppImage"', 'apollo');
    expect(d).toContain('Exec="/x/Apollo.AppImage" %U');
    expect(d).toContain('x-scheme-handler/http;x-scheme-handler/https;');
    expect(d).toContain('Categories=Network;WebBrowser;');
  });

  it('o ícone do app existe', () => {
    expect(fs.readFileSync(path.join(__dirname, '../../assets/icon.svg'), 'utf8')).toContain('<svg');
    expect(os.platform()).toBeTruthy();
  });
});

// Regressão (relatado): a atualização do AppImage trocou Apollo-0.8.0.AppImage por
// Apollo-0.9.0.AppImage e a entrada do menu (navegador padrão) ficou apontando para o
// arquivo apagado — o Apollo não abria mais pelo menu nem pelos links.
describe('entrada do menu acompanha o AppImage', () => {
  const setup = (exec: string) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-de-'));
    const dir = path.join(home, '.local/share/applications');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'apollo.desktop'), desktopEntry(exec, 'apollo'));
    return { home, read: () => fs.readFileSync(path.join(dir, 'apollo.desktop'), 'utf8') };
  };

  it('atualização com troca de nome: passa a apontar para o arquivo novo', () => {
    const { home, read } = setup('"/u/builds/Apollo-0.8.0.AppImage"');
    expect(retargetDesktopEntry('/u/builds/Apollo.AppImage', '/u/builds/Apollo-0.8.0.AppImage', home)).toBe(true);
    expect(read()).toContain('Exec="/u/builds/Apollo.AppImage" %U');
    expect(read()).toContain('MimeType=text/html;');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('ao abrir: conserta entrada que aponta para um AppImage apagado; não mexe se o arquivo existe', () => {
    const { home, read } = setup('"/u/builds/Apollo-0.8.0.AppImage"');
    expect(retargetDesktopEntry('/u/builds/Apollo-0.9.0.AppImage', null, home, () => true)).toBe(false);
    expect(retargetDesktopEntry('/u/builds/Apollo-0.9.0.AppImage', null, home, () => false)).toBe(true);
    expect(read()).toContain('Exec="/u/builds/Apollo-0.9.0.AppImage" %U');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('entrada que não é de AppImage (dev, AUR) ou inexistente: nada muda; caminho com caracteres especiais', () => {
    const dev = setup('"/e/electron" "/src/apollo"');
    expect(retargetDesktopEntry('/x/Apollo.AppImage', null, dev.home, () => false)).toBe(false);
    expect(retargetDesktopEntry('/x/Apollo.AppImage', null, path.join(os.tmpdir(), 'nao-existe-apollo'))).toBe(false);
    const esp = setup(launchCommand({ appImage: '/u/meus $apps/Apollo-0.8.0.AppImage', execPath: '', packaged: true, appPath: '' }));
    expect(retargetDesktopEntry('/u/meus $apps/Apollo.AppImage', '/u/meus $apps/Apollo-0.8.0.AppImage', esp.home)).toBe(true);
    expect(esp.read()).toContain('Exec="/u/meus \\$apps/Apollo.AppImage" %U');
    for (const h of [dev.home, esp.home]) fs.rmSync(h, { recursive: true, force: true });
  });
});
