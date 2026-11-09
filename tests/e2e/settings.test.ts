// Fase 3d: configurações (DNS, padrões globais) e workspace temporário.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, sleep, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const readSettings = () => JSON.parse(fs.readFileSync(path.join(profile.dir, 'settings.json'), 'utf8'));

describe('configurações', () => {
  it('abre pelo botão e mostra o DNS em uso', async () => {
    await app.ui.mouseClick('#settings-btn');
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('settings-dialog').open`), 'diálogo');
    expect(await app.ui.eval(`document.getElementById('dns-mode').value`)).toBe('secure');
    expect(await app.ui.eval(`document.getElementById('dns-status').textContent`)).toContain('cloudflare-public');
  });

  it('endereço do Gateway: salvo no settings.json local (só do usuário) e aplicado', async () => {
    await app.ui.eval(`document.getElementById('dns-url').value = 'https://teste-gw.example/dns-query'; true`);
    await app.ui.mouseClick('#dns-save');
    const s = await app.until((x) => x.settings.dns.dohUrl === 'https://teste-gw.example/dns-query', 'aplicado');
    expect(s.settings.dns.provider).toMatch(/custom/);
    expect(readSettings().dns).toEqual({ mode: 'secure', dohUrl: 'https://teste-gw.example/dns-query' });
    if (process.platform !== 'win32') expect(fs.statSync(path.join(profile.dir, 'settings.json')).mode & 0o777).toBe(0o600);
  });

  it('endereço inválido (http) é recusado na tela e no processo principal', async () => {
    await app.ui.eval(`document.getElementById('dns-url').value = 'http://inseguro.example/dns'; true`);
    await app.ui.mouseClick('#dns-save');
    expect(await app.ui.eval(`document.getElementById('dns-status').textContent`)).toContain('https://');
    await app.send({ type: 'settings:dns', mode: 'secure', dohUrl: 'http://inseguro.example/dns' });
    await sleep(200);
    expect((await app.state()).settings.dns.dohUrl).toBe('https://teste-gw.example/dns-query');
  });

  it('voltar ao padrão: modo e endereço limpos', async () => {
    await app.send({ type: 'settings:dns', mode: 'secure', dohUrl: null });
    const s = await app.until((x) => x.settings.dns.dohUrl === null, 'padrão');
    expect(s.settings.dns.provider).toBe('cloudflare-public');
    await app.ui.eval(`document.getElementById('settings-dialog').close(); true`);
  });

  it('padrão global de privacidade vale para todos os workspaces (camada "global")', async () => {
    await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=G` });
    await app.until((x) => app.activeTab(x).title === 'G', 'página');
    await app.send({ type: 'privacy:set', scope: 'global', feature: 'ads', enabled: false });
    const s = await app.until((x) => x.settings.privacy.ads === false && x.sitePrivacy?.toggles.ads === false, 'global');
    expect(s.sitePrivacy!.source.ads).toBe('global');
    await app.send({ type: 'privacy:set', scope: 'global', feature: 'ads', enabled: null });
    await app.until((x) => x.settings.privacy.ads === null, 'de volta ao padrão');
  });
});

describe('workspace temporário', () => {
  it('funciona normalmente, mas nada vai para o disco e some ao reabrir', async () => {
    await app.send({ type: 'workspace:create', name: 'Anônimo', color: '#444444', home: '', temporary: true });
    let s = await app.until((x) => x.workspaces.some((w) => w.temporary), 'temporário criado');
    const temp = s.workspaces.find((w) => w.temporary)!;
    expect(s.activeWorkspaceId).toBe(temp.id);
    expect(await app.ui.eval(`document.querySelector('.ws-btn.temporary') !== null`)).toBe(true);

    // Login (cookie persistente) funciona durante a execução.
    await app.send({ type: 'tab:navigate', url: `${site.url}/set-cookie?v=anon` });
    await app.until((x) => app.activeTab(x).url.includes('set-cookie') && !app.activeTab(x).loading, 'cookie');
    await app.send({ type: 'tab:navigate', url: `${site.url}/cookie` });
    await app.until((x) => app.activeTab(x).url.endsWith('/cookie') && !app.activeTab(x).loading, 'lido');
    expect(site.cookies.get('/cookie')).toContain('login=anon');

    // Nenhuma partição em disco para ele.
    const partitions = path.join(profile.dir, 'Partitions');
    const onDisk = () => (fs.existsSync(partitions) ? fs.readdirSync(partitions) : []).filter((d) => d.includes(temp.id));
    expect(onDisk()).toEqual([]);

    await app.quit();
    app = await Apollo.launch(profile.dir);
    s = await app.state();
    expect(s.workspaces.some((w) => w.id === temp.id || w.temporary)).toBe(false);
    expect(onDisk()).toEqual([]);
  });
});
