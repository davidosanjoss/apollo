import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDns, loadSettings } from '../../src/main/settings';
import { tempDir } from '../helpers';

let dir: string;
let cleanup: () => void;

beforeEach(() => {
  ({ dir, cleanup } = tempDir());
  vi.mocked(app.getPath).mockReturnValue(dir);
  vi.mocked(app.configureHostResolver).mockClear();
  delete process.env.APOLLO_DOH_URL;
});
afterEach(() => cleanup());

const writeSettings = (content: string) => fs.writeFileSync(path.join(dir, 'settings.json'), content);

describe('loadSettings', () => {
  it('sem arquivo: DNS seguro com servidor público', () => {
    expect(loadSettings()).toEqual({ dns: { mode: 'secure', dohUrl: null } });
  });

  it('lê o arquivo do usuário', () => {
    writeSettings(JSON.stringify({ dns: { mode: 'automatic', dohUrl: 'https://x.example/dns-query' } }));
    expect(loadSettings().dns).toEqual({ mode: 'automatic', dohUrl: 'https://x.example/dns-query' });
  });

  it('arquivo inválido não impede o app de abrir', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeSettings('{ isso não é json');
    expect(loadSettings().dns.mode).toBe('secure');
    warn.mockRestore();
  });

  it('APOLLO_DOH_URL tem prioridade', () => {
    writeSettings(JSON.stringify({ dns: { dohUrl: 'https://a.example/dns-query' } }));
    process.env.APOLLO_DOH_URL = 'https://env.example/dns-query';
    expect(loadSettings().dns.dohUrl).toBe('https://env.example/dns-query');
  });
});

describe('applyDns', () => {
  it('off: não mexe no resolvedor', () => {
    expect(applyDns({ dns: { mode: 'off', dohUrl: null } })).toEqual({ mode: 'off' });
    expect(app.configureHostResolver).not.toHaveBeenCalled();
  });

  it('usa o endereço configurado (Zero Trust Gateway)', () => {
    const info = applyDns({ dns: { mode: 'secure', dohUrl: 'https://gw.example/dns-query' } });
    expect(app.configureHostResolver).toHaveBeenCalledWith({ secureDnsMode: 'secure', secureDnsServers: ['https://gw.example/dns-query'] });
    expect(info.provider).toMatch(/custom/);
  });

  it('endereço sem https cai no público (nunca DNS em texto puro)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = applyDns({ dns: { mode: 'automatic', dohUrl: 'http://inseguro.example/dns' } });
    expect(app.configureHostResolver).toHaveBeenCalledWith({ secureDnsMode: 'automatic', secureDnsServers: ['https://cloudflare-dns.com/dns-query'] });
    expect(info.provider).toBe('cloudflare-public');
    warn.mockRestore();
  });
});
