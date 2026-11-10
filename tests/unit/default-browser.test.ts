import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { desktopEntry, launchCommand, urlFromArgv } from '../../src/main/default-browser';

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
