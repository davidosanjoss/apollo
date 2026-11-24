// Passkeys pelo Bitwarden: o site cria e usa passkeys guardadas no cofre (sem chave física).
// Quem confere as respostas é uma biblioteca de servidor WebAuthn (como um site de verdade faria).
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PASSWORD, makeFixture } from '../fixtures/bitwarden';
import { Apollo, startFakeBitwarden, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let bw: Awaited<ReturnType<typeof startFakeBitwarden>>;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let page: Cdp;
let origin: string;
let credential: WebAuthnCredential;

beforeAll(async () => {
  site = await startSite();
  origin = site.url.replace('127.0.0.1', 'localhost'); // passkey não pode ser de IP
  const fx = await makeFixture([{ name: 'Site com senha', username: 'eu@teste.com', password: 's', uris: [{ uri: origin }] }]);
  bw = await startFakeBitwarden('segredo', fx.token, fx.sync);
  profile = tempProfile();
  app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1' });
  await app.send({ type: 'vault:connect', server: bw.url, clientId: 'user.1', clientSecret: 'segredo', password: FIXTURE_PASSWORD });
  await app.until((s) => s.vault.status === 'unlocked', 'cofre aberto', 15_000);
  await app.send({ type: 'tab:navigate', url: `${origin}/passkeys` });
  await app.until((s) => app.activeTab(s).title === 'Passkeys' && !app.activeTab(s).loading, 'página');
  page = await app.page(`${origin}/passkeys`);
});
afterAll(async () => {
  page?.close();
  await app?.quit();
  await bw?.close();
  await site?.close();
  profile?.cleanup();
});

const result = async () => JSON.parse(await waitFor(() => page.eval<string | null>('window.resultado'), 'resposta do navegador', 15_000)) as
  { ok?: any; erro?: string; instancia?: boolean };
const dialogOpen = () => app.ui.eval<boolean>(`document.getElementById('passkey-dialog').open`);

describe('passkeys pelo Bitwarden', () => {
  it('criar: o Apollo pergunta onde salvar, grava no cofre e o servidor do site aceita', async () => {
    const options = await generateRegistrationOptions({ rpName: 'Teste', rpID: 'localhost', userName: 'eu@teste.com', attestationType: 'none' });
    await page.eval(`window.criar(${JSON.stringify(options)})`);
    const s = await app.until((x) => x.passkeyPrompt !== null, 'janela da passkey');
    expect(s.passkeyPrompt).toMatchObject({ kind: 'create', site: 'localhost', userName: 'eu@teste.com', vault: 'unlocked' });
    expect(s.passkeyPrompt!.options.map((o) => o.label)).toEqual(['Login novo', 'Site com senha — eu@teste.com']);
    await waitFor(dialogOpen, 'janela aberta');
    // Salvar no login que já existe (com a senha): clique de verdade na opção e em "Salvar passkey".
    await app.ui.mouseClick(`#passkey-options .passkey-opt[data-option="item-0"]`);
    await app.ui.mouseClick('#passkey-ok');
    const r = await result();
    expect(r.erro).toBeUndefined();
    expect(r.instancia).toBe(true);
    const v = await verifyRegistrationResponse({ response: r.ok, expectedChallenge: options.challenge, expectedOrigin: origin, expectedRPID: 'localhost' });
    expect(v.verified).toBe(true);
    expect(v.registrationInfo!.aaguid).toBe('d548826e-79b4-db40-a3d8-11116f7e8349'); // Bitwarden
    expect(v.registrationInfo!.credentialBackedUp).toBe(true);
    credential = v.registrationInfo!.credential;
    // Gravou no login existente, sem perder a senha.
    const put = bw.writes.find((w) => w.method === 'PUT' && w.id === 'item-0')!;
    expect(put.body.login.fido2Credentials).toHaveLength(1);
    expect(put.body.login.password).toBeTruthy();
    await waitFor(async () => !(await dialogOpen()), 'janela fechou');
    expect((await app.state()).passkeyPrompt).toBeNull();
  });

  it('entrar: escolhe a passkey e o servidor do site confere a assinatura', async () => {
    const options = await generateAuthenticationOptions({ rpID: 'localhost', allowCredentials: [] });
    await page.eval(`window.entrar(${JSON.stringify(options)})`);
    const s = await app.until((x) => x.passkeyPrompt?.kind === 'get', 'janela de entrar');
    expect(s.passkeyPrompt!.options.map((o) => o.label)).toEqual(['eu@teste.com']);
    await waitFor(dialogOpen, 'janela aberta');
    await app.ui.mouseClick('#passkey-ok'); // uma só: já vem escolhida
    const r = await result();
    expect(r.instancia).toBe(true);
    const v = await verifyAuthenticationResponse({ response: r.ok, expectedChallenge: options.challenge, expectedOrigin: origin,
      expectedRPID: 'localhost', credential });
    expect(v.verified).toBe(true);
    expect(Buffer.from(r.ok.response.userHandle, 'base64url').length).toBeGreaterThan(0);
  });

  it('cancelar: o site recebe NotAllowedError', async () => {
    const options = await generateAuthenticationOptions({ rpID: 'localhost' });
    await page.eval(`window.entrar(${JSON.stringify(options)})`);
    await app.until((x) => x.passkeyPrompt !== null, 'janela');
    await waitFor(dialogOpen, 'janela aberta');
    await app.ui.mouseClick('#passkey-cancel');
    expect((await result()).erro).toBe('NotAllowedError');
  });

  it('login condicional (preenchimento): sem janela; o menu da chave oferece a passkey', async () => {
    const options = await generateAuthenticationOptions({ rpID: 'localhost' });
    await page.eval(`window.entrar(${JSON.stringify(options)}, true)`);
    await new Promise((r) => setTimeout(r, 300));
    expect((await app.state()).passkeyPrompt).toBeNull();
    const main = await app.main();
    await app.send({ type: 'vault:menu', x: 10, y: 10 });
    const labels = await main.eval<string[]>('globalThis.__apolloTest.browser.lastMenu.map((i) => i.label)');
    expect(labels[0]).toBe('Entrar com passkey — eu@teste.com');
    await main.eval('globalThis.__apolloTest.browser.lastMenu[0].click(); true');
    const r = await result();
    const v = await verifyAuthenticationResponse({ response: r.ok, expectedChallenge: options.challenge, expectedOrigin: origin,
      expectedRPID: 'localhost', credential });
    expect(v.verified).toBe(true);
  });

  it('o site desiste (AbortController): a janela some', async () => {
    const options = await generateAuthenticationOptions({ rpID: 'localhost' });
    await page.eval(`window.entrar(${JSON.stringify(options)})`);
    await app.until((x) => x.passkeyPrompt !== null, 'janela');
    await page.eval('window.ctl.abort(); true');
    expect((await result()).erro).toBe('AbortError');
    await app.until((x) => x.passkeyPrompt === null, 'janela sumiu');
  });
});
