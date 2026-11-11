// Versão nova (janela com as notas) e novidades depois de atualizar, contra uma API de
// releases falsa (no lugar da do GitHub).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, tempProfile, waitFor, type Cdp } from './harness';

let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let api: http.Server;
let apiUrl: string;
let main: Cdp;
let current = '';
const calls: string[] = [];

const NOTES = '### Adicionado\n- **Barra de favoritos** com pastas\n- Janela de histórico\n\n### Corrigido\n- <script>alert(1)</script>Vídeo em tela cheia';

beforeAll(async () => {
  api = http.createServer((req, res) => {
    calls.push(req.url ?? '');
    const json = (body: object) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/releases/latest') return json({ tag_name: 'v99.0.0', body: NOTES, html_url: 'https://phishing.example/x' });
    if (req.url?.startsWith('/releases/tags/v')) return json({ tag_name: req.url.split('/').pop(), body: '### Adicionado\n- Coisa nova', html_url: `${apiUrl}/r` });
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  profile = tempProfile();
  app = await launch();
  current = (await app.state()).updateAbout.version;
});
afterAll(async () => {
  await app?.quit();
  api?.close();
  profile?.cleanup();
});

async function launch() {
  const a = await Apollo.launch(profile.dir, { APOLLO_UPDATES_API: apiUrl, APOLLO_TEST_UPDATE_DELAY_MS: '300', APOLLO_TEST_HOOKS: '1' });
  main = await a.main();
  return a;
}
const ui = <T>(js: string) => app.ui.eval<T>(js);
const dialogOpen = () => ui<boolean>(`document.getElementById('update-dialog').open`);

describe('versão nova', () => {
  it('janela com as notas (só texto) e o link para baixar', async () => {
    await waitFor(dialogOpen, 'janela de versão nova');
    expect(await ui<string>(`document.getElementById('update-dialog-title').textContent`)).toBe('Apollo 99.0.0 disponível');
    expect(await ui<string[]>(`[...document.querySelectorAll('#update-notes h4, #update-notes li')].map((e) => e.textContent)`))
      .toEqual(['Adicionado', 'Barra de favoritos com pastas', 'Janela de histórico', 'Corrigido', 'Vídeo em tela cheia']);
    expect(await ui<number>(`document.querySelectorAll('#update-notes script, #update-notes b').length`)).toBe(0);
    // Esta cópia não se instala sozinha: botão abre a página (e nunca um link de fora do repositório).
    expect(await ui<string>(`document.getElementById('update-go').textContent`)).toBe('Abrir a página de download');
    const s = await app.state();
    expect(s.updateNotice!.url).toBe(`https://github.com/davidosanjoss/apollo/releases/tag/v99.0.0`);
    expect(s.updateAbout.latest).toBe('99.0.0');
  });

  it('"Pular esta versão": não volta nem depois de reiniciar', async () => {
    await app.ui.mouseClick('#update-skip');
    await app.until((s) => s.updateNotice === null, 'fechou');
    await app.quit();
    app = await launch();
    await waitFor(async () => calls.filter((c) => c === '/releases/latest').length >= 2, 'verificou de novo');
    await new Promise((r) => setTimeout(r, 500));
    expect(await dialogOpen()).toBe(false);
  });

  it('"Verificar atualizações" (Configurações → Sobre) mostra mesmo a versão pulada', async () => {
    await app.ui.mouseClick('#settings-btn');
    await app.ui.mouseClick('#settings-nav button[data-section="about"]');
    await waitFor(async () => (await ui<string>(`document.getElementById('about-status').textContent`)).includes('99.0.0'), 'status');
    await app.ui.mouseClick('#about-check');
    await waitFor(dialogOpen, 'janela de novo');
    await app.ui.mouseClick('#update-dismiss'); // "Depois"
    await app.until((s) => s.updateNotice === null, 'fechou');
  });
});

describe('novidades depois de atualizar', () => {
  it('na primeira abertura de uma versão nova, mostra o que mudou (uma vez)', async () => {
    await main.eval(`globalThis.__apolloTest.browser.store.setKv('last-version', '0.0.1'); true`); // "estava" numa versão antiga
    await app.quit();
    app = await launch();
    await waitFor(dialogOpen, 'novidades');
    // A janela de versão nova (99.0.0, pulada) pode chegar depois; as novidades vêm primeiro.
    expect(await ui<string>(`document.getElementById('update-dialog-title').textContent`)).toBe(`Novidades do Apollo ${current}`);
    expect(await ui<string[]>(`[...document.querySelectorAll('#update-notes li')].map((e) => e.textContent)`)).toEqual(['Coisa nova']);
    expect(calls).toContain(`/releases/tags/v${current}`);
    await app.ui.mouseClick('#update-dismiss');
    await app.quit();
    app = await launch();
    await new Promise((r) => setTimeout(r, 1000));
    expect(await dialogOpen()).toBe(false); // só uma vez
  });
});

describe('instalado pelo AUR', () => {
  it('a janela de versão nova manda atualizar pelo gerenciador de pacotes (sem botão de download)', async () => {
    await app.quit();
    const profile2 = tempProfile();
    app = await Apollo.launch(profile2.dir, { APOLLO_UPDATES_API: apiUrl, APOLLO_TEST_UPDATE_DELAY_MS: '300', APOLLO_TEST_PACKAGE_TYPE: 'aur' });
    try {
      await waitFor(dialogOpen, 'janela de versão nova');
      expect(await ui<string>(`document.getElementById('update-dialog-sub').textContent`)).toContain('gerenciador de pacotes');
      expect(await ui<boolean>(`document.getElementById('update-go').hidden`)).toBe(true);
    } finally {
      await app.quit();
      profile2.cleanup();
    }
  });
});
