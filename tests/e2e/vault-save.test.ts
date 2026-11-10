// Fase 4d: salvar/atualizar senhas no Bitwarden e gerador.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PASSWORD, makeFixture } from '../fixtures/bitwarden';
import { Apollo, sleep, startFakeBitwarden, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let bw: Awaited<ReturnType<typeof startFakeBitwarden>>;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;

beforeAll(async () => {
  site = await startSite();
  const fx = await makeFixture([{ name: 'Outro', username: 'x', password: 'y', uris: [{ uri: 'https://outro.com' }] }]);
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

async function open(path: string): Promise<Cdp> {
  await app.send({ type: 'tab:navigate', url: `${site.url}${path}` });
  await app.until((s) => app.activeTab(s).url === `${site.url}${path}` && !app.activeTab(s).loading, `abrir ${path}`);
  return app.page(`${site.url}${path}`);
}

/**
 * O usuário digita e aperta Enter na senha (evento de teclado real). Obs.: um
 * requestSubmit() por script não dispara o submit nesta página — não serve de teste.
 */
async function submitLogin(user: string, pass: string, base = site.url) {
  await app.send({ type: 'tab:navigate', url: `${base}/login` });
  await app.until((s) => app.activeTab(s).url === `${base}/login` && !app.activeTab(s).loading, 'página de login');
  const page = await app.page(`${base}/login`);
  await page.eval(`document.getElementById('email').value = ${JSON.stringify(user)};
    document.getElementById('senha').value = ${JSON.stringify(pass)}; true`);
  await page.pressEnter('#senha');
  page.close();
}

const clickSave = async (id: string) => { await app.ui.mouseClick(id); };

describe('salvar senhas', () => {
  it('login novo: barra oferece salvar (senha nunca vai para a interface)', async () => {
    await submitLogin('eu@teste.com', 'senha-1');
    const s = await app.until((x) => x.savePrompt?.mode === 'save', 'barra de salvar');
    expect(s.savePrompt).toMatchObject({ site: '127.0.0.1', username: 'eu@teste.com' });
    expect(JSON.stringify(s)).not.toContain('senha-1');
    expect(await app.ui.eval(`!document.getElementById('save-bar').hidden`)).toBe(true);
  });

  it('Salvar grava no Bitwarden (cifrado) e o site passa a ter o login', async () => {
    await clickSave('#save-yes');
    await app.until((x) => x.savePrompt === null && x.vault.count === 2, 'salvo e sincronizado', 15_000);
    const w = bw.writes.at(-1)!;
    expect(w.method).toBe('POST');
    expect(JSON.stringify(w.body)).not.toContain('senha-1');
    expect(JSON.stringify(w.body)).not.toContain('eu@teste.com');
    await app.until((x) => x.vaultSite?.count === 1, 'chave conta o novo login');
  });

  it('mesmo login de novo: nada a oferecer', async () => {
    const before = bw.writes.length;
    await submitLogin('eu@teste.com', 'senha-1');
    await sleep(500);
    expect((await app.state()).savePrompt).toBeNull();
    expect(bw.writes.length).toBe(before);
  });

  it('senha mudou: oferece atualizar e troca só a senha', async () => {
    await submitLogin('eu@teste.com', 'senha-2');
    await app.until((x) => x.savePrompt?.mode === 'update', 'barra de atualizar');
    expect(await app.ui.eval(`document.getElementById('save-yes').textContent`)).toBe('Atualizar');
    await clickSave('#save-yes');
    await app.until((x) => x.savePrompt === null, 'atualizado');
    const w = await waitFor(() => bw.writes.find((x) => x.method === 'PUT'), 'PUT no servidor');
    expect(w.body.passwordHistory).toHaveLength(1); // senha antiga (cifrada) no histórico
    // A nova senha já é a salva: enviar de novo não oferece nada.
    await waitFor(async () => { await submitLogin('eu@teste.com', 'senha-2'); await sleep(300); return (await app.state()).savePrompt === null; }, 'nada mais a oferecer');
  });

  it('"Agora não" some; "Nunca neste site" não pergunta mais', async () => {
    await submitLogin('outra@pessoa.com', 'abc');
    await app.until((x) => x.savePrompt?.mode === 'save', 'barra');
    await clickSave('#save-no');
    await app.until((x) => x.savePrompt === null, 'dispensada');
    await submitLogin('outra@pessoa.com', 'abc');
    await app.until((x) => x.savePrompt?.mode === 'save', 'barra de novo');
    await clickSave('#save-never');
    await app.until((x) => x.savePrompt === null, 'nunca');
    await submitLogin('terceira@pessoa.com', 'def');
    await sleep(500);
    expect((await app.state()).savePrompt).toBeNull();
  });
});

describe('cofre bloqueado e duas etapas', () => {
  it('bloqueado: a barra pede para desbloquear; depois vira "Salvar"', async () => {
    // Novo site (localhost) para não cair no "nunca" do 127.0.0.1.
    await app.send({ type: 'vault:lock' });
    await app.until((x) => x.vault.status === 'locked', 'bloqueado');
    await submitLogin('eu', 'p', site.thirdParty);
    await app.until((x) => x.savePrompt?.mode === 'locked', 'barra de desbloquear');
    await app.send({ type: 'vault:unlock', password: FIXTURE_PASSWORD });
    await app.until((x) => x.vault.status === 'unlocked' && x.savePrompt?.mode === 'save', 'agora salvar');
    await app.send({ type: 'vault:save-answer', promptId: (await app.state()).savePrompt!.id, action: 'dismiss' });
  });

  it('login em duas etapas: o e-mail da 1ª etapa acompanha a senha da 2ª', async () => {
    await app.send({ type: 'tab:navigate', url: `${site.thirdParty}/step1` });
    await app.until((s) => app.activeTab(s).url.endsWith('/step1') && !app.activeTab(s).loading, 'etapa 1');
    let page = await app.page(`${site.thirdParty}/step1`);
    await page.eval(`document.getElementById('email').value = 'eu@empresa.com'; true`);
    await page.mouseClick('#avancar');
    page.close();
    await app.send({ type: 'tab:navigate', url: `${site.thirdParty}/step2` });
    await app.until((s) => app.activeTab(s).url.endsWith('/step2') && !app.activeTab(s).loading, 'etapa 2');
    page = await app.page(`${site.thirdParty}/step2`);
    await page.eval(`document.getElementById('senha').value = 'segredo-2'; true`);
    await page.mouseClick('#entrar');
    page.close();
    const s = await app.until((x) => x.savePrompt?.mode === 'save', 'barra');
    expect(s.savePrompt!.username).toBe('eu@empresa.com');
  });
});

describe('gerador', () => {
  it('preenche senha e confirmação com a mesma senha forte', async () => {
    await app.send({ type: 'vault:generator', length: 24, symbols: true });
    await app.until((x) => x.generator.length === 24, 'opções salvas');
    const page = await open('/signup');
    await app.send({ type: 'vault:generate', fill: true });
    const v = await waitFor(async () => {
      const r = await page.eval<{ nova: string; conf: string }>(`({ nova: document.getElementById('nova').value, conf: document.getElementById('conf').value })`);
      return r.nova ? r : null;
    }, 'preenchido');
    expect(v.nova).toBe(v.conf);
    expect(v.nova).toHaveLength(24);
    expect(v.nova).toMatch(/[^A-Za-z0-9]/);
    page.close();
  });
});
