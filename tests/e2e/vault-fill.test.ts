// Fase 4c: preenchimento de logins do Bitwarden.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PASSWORD, makeFixture } from '../fixtures/bitwarden';
import { Apollo, sleep, startFakeBitwarden, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let bw: Awaited<ReturnType<typeof startFakeBitwarden>>;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
const ids = { site: 'item-0', other: 'item-1' };

beforeAll(async () => {
  site = await startSite();
  const fx = await makeFixture([
    { name: 'Site de teste', username: 'eu@teste.com', password: 'senha-do-site', uris: [{ uri: site.url }], totp: 'JBSWY3DPEHPK3PXP' },
    { name: 'Outro site', username: 'outra@pessoa.com', password: 'senha-de-outro', uris: [{ uri: 'https://banco.com' }] },
  ]);
  bw = await startFakeBitwarden('segredo', fx.token, fx.sync);
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
  await app.send({ type: 'vault:connect', server: bw.url, clientId: 'user.1', clientSecret: 'segredo', password: FIXTURE_PASSWORD });
  await app.until((s) => s.vault.status === 'unlocked', 'cofre aberto', 15_000);
});
afterAll(async () => {
  await app?.quit();
  await bw?.close();
  await site?.close();
  profile?.cleanup();
});

const values = (page: Cdp) => page.eval<{ email: string; senha: string; busca: string }>(
  `({ email: document.getElementById('email').value, senha: document.getElementById('senha').value, busca: document.getElementById('busca').value })`);

async function openLogin(base: string): Promise<Cdp> {
  await app.send({ type: 'tab:navigate', url: `${base}/login` });
  await app.until((s) => app.activeTab(s).url === `${base}/login` && !app.activeTab(s).loading, 'página de login');
  return app.page(`${base}/login`);
}

describe('preenchimento', () => {
  it('chave na barra mostra quantos logins servem para o site', async () => {
    const page = await openLogin(site.url);
    const s = await app.until((x) => x.vaultSite?.count === 1, 'um login para o site');
    expect(s.vaultSite).toEqual({ status: 'unlocked', count: 1 });
    await waitFor(() => app.ui.eval<boolean>(`!document.getElementById('key-btn').hidden && document.getElementById('key-count').textContent === '1'`), 'chave com 1');
    page.close();
  });

  it('preenche usuário e senha no site certo (sem tocar em outros campos)', async () => {
    const page = await app.page(`${site.url}/login`);
    await app.send({ type: 'vault:fill', itemId: ids.site });
    await waitFor(async () => (await values(page)).senha === 'senha-do-site', 'preenchido');
    expect(await values(page)).toEqual({ email: 'eu@teste.com', senha: 'senha-do-site', busca: '' });
    page.close();
  });

  it('login de OUTRO site é recusado, mesmo pedindo explicitamente', async () => {
    const page = await openLogin(site.url);
    await app.send({ type: 'vault:fill', itemId: ids.other });
    await sleep(500);
    expect(await values(page)).toEqual({ email: '', senha: '', busca: '' });
    page.close();
  });

  it('página em outro domínio (localhost ≠ 127.0.0.1): nada para oferecer nem preencher', async () => {
    const page = await openLogin(site.thirdParty);
    const s = await app.until((x) => x.vaultSite?.count === 0, 'nenhum login');
    expect(s.vaultSite!.count).toBe(0);
    await app.send({ type: 'vault:fill', itemId: ids.site });
    await sleep(500);
    expect((await values(page)).senha).toBe('');
    page.close();
  });

  it('cofre bloqueado: chave indica bloqueio e nada é preenchido', async () => {
    const page = await openLogin(site.url);
    await app.send({ type: 'vault:lock' });
    const s = await app.until((x) => x.vaultSite?.status === 'locked', 'bloqueado');
    expect(s.vaultSite!.count).toBe(0);
    await app.send({ type: 'vault:fill', itemId: ids.site });
    await sleep(500);
    expect((await values(page)).senha).toBe('');
    page.close();
  });

  it('"Desbloquear…" do menu abre o diálogo do cofre', async () => {
    await app.send({ type: 'vault:open' });
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('vault-dialog').open`), 'diálogo');
    await app.ui.eval(`document.getElementById('vault-dialog').close(); true`);
  });
});
