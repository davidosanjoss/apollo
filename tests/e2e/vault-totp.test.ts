// App autenticador pelo Bitwarden: código copiado ao preencher, preenchido na etapa seguinte,
// lista de códigos e cadastro do autenticador pelo QR code da página.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PASSWORD, makeFixture } from '../fixtures/bitwarden';
import { parseTotp, totp } from '../../src/main/vault/totp';
import { Apollo, startFakeBitwarden, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let bw: Awaited<ReturnType<typeof startFakeBitwarden>>;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let main: Cdp;
const SECRET = 'JBSWY3DPEHPK3PXP';
const NEW_URI = 'otpauth://totp/Teste:sem2fa%40teste.com?secret=KRSXG5CTMVRXEZLUKN2XAZLSKNSWG4TFOQ&issuer=Teste';
const code = (secret = SECRET) => totp(parseTotp(secret)).code;

beforeAll(async () => {
  site = await startSite();
  const fx = await makeFixture([
    { name: 'Site de teste', username: 'eu@teste.com', password: 'senha-do-site', uris: [{ uri: site.url }], totp: SECRET },
    { name: 'Site de teste', username: 'sem2fa@teste.com', password: 'outra', uris: [{ uri: site.url }] },
  ]);
  bw = await startFakeBitwarden('segredo', fx.token, fx.sync);
  profile = tempProfile();
  app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1' });
  main = await app.main();
  await app.send({ type: 'vault:connect', server: bw.url, clientId: 'user.1', clientSecret: 'segredo', password: FIXTURE_PASSWORD });
  await app.until((s) => s.vault.status === 'unlocked', 'cofre aberto', 15_000);
});
afterAll(async () => {
  await app?.quit();
  await bw?.close();
  await site?.close();
  profile?.cleanup();
});

async function open(path: string, title: string): Promise<Cdp> {
  await app.send({ type: 'tab:navigate', url: `${site.url}${path}` });
  await app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, title);
  return app.page(`${site.url}${path}`);
}
const digits = (p: Cdp) => p.eval<string>(`[0,1,2,3,4,5].map((i) => document.getElementById('d' + i).value).join('')`);
const clipboard = () => main.eval<string>('globalThis.__apolloTest.clipboard()');
const menuLabels = () => main.eval<string[]>(`(() => { const out = []; const walk = (items) => { for (const i of items) { if (i.label) out.push(i.label); if (i.submenu) walk(i.submenu); } };
  walk(globalThis.__apolloTest.browser.lastMenu); return out; })()`);
const clickMenu = (label: string) => main.eval<boolean>(`(() => { const find = (items) => { for (const i of items) { if (i.label === ${JSON.stringify(label)}) return i;
  const s = i.submenu && find(i.submenu); if (s) return s; } }; const it = find(globalThis.__apolloTest.browser.lastMenu); if (!it) return false; it.click(); return true; })()`);

describe('app autenticador (TOTP do Bitwarden)', () => {
  it('preencher a senha copia o código; a tela seguinte de código é preenchida sozinha', async () => {
    const login = await open('/login', 'Entrar');
    await app.send({ type: 'vault:fill', itemId: 'item-0' });
    await waitFor(async () => (await login.eval<string>(`document.getElementById('senha').value`)) === 'senha-do-site', 'senha preenchida');
    await waitFor(async () => (await clipboard()) === code(), 'código na área de transferência');
    login.close();
    const otp = await open('/codigo', 'Verificação');
    await waitFor(async () => (await digits(otp)) === code(), 'código preenchido nas caixinhas', 8000);
    otp.close();
  });

  it('sem login preenchido antes: não preenche sozinho; o menu da chave preenche', async () => {
    await app.send({ type: 'tab:new' });
    const otp = await open('/codigo', 'Verificação');
    await new Promise((r) => setTimeout(r, 900));
    expect(await digits(otp)).toBe('');
    await app.send({ type: 'vault:menu', x: 10, y: 10 });
    expect(await menuLabels()).toContain('Preencher código de verificação');
    expect(await clickMenu('Preencher código de verificação')).toBe(true);
    await waitFor(async () => (await digits(otp)) === code(), 'preenchido pelo menu');
    otp.close();
  });

  it('lista de códigos: mostra o código atual de cada login com autenticador', async () => {
    await app.send({ type: 'vault:totp-codes', open: true });
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('totp-dialog').open`), 'lista aberta');
    await waitFor(async () => (await app.ui.eval<string>(`document.querySelector('#totp-list .totp-item .c')?.textContent ?? ''`)).replace(' ', '') === code(), 'código na lista');
    expect(await app.ui.eval<number>(`document.querySelectorAll('#totp-list .totp-item').length`)).toBe(1);
    await app.ui.mouseClick('#totp-list .totp-item');
    await waitFor(async () => (await clipboard()) === code(), 'copiado');
    await app.ui.eval(`document.getElementById('totp-dialog').close(); true`);
  });

  it('configurar autenticador: lê o QR code da página, salva no login escolhido e preenche o código de confirmação', async () => {
    const page = await open(`/autenticador?uri=${encodeURIComponent(NEW_URI)}`, 'Autenticador');
    await waitFor(() => page.eval<boolean>(`document.querySelector('img')?.complete === true`), 'QR desenhado');
    await app.send({ type: 'totp:scan' });
    const s = await app.until((x) => x.totpSetup !== null, 'janela do autenticador', 10_000);
    expect(s.totpSetup!.found).toEqual({ issuer: 'Teste', account: 'sem2fa@teste.com' });
    expect(s.totpSetup!.suggested).toBe('item-1'); // a conta do QR
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('totp-setup-dialog').open`), 'janela aberta');
    await app.ui.mouseClick('#totp-setup-save');
    await app.until((x) => x.totpSetup === null, 'salvou');
    const put = bw.writes.find((w) => w.method === 'PUT' && w.id === 'item-1')!;
    expect(put.body.login.totp).toBeTruthy();
    expect(put.body.login.password).toBeTruthy(); // o resto do item não mudou
    const newCode = code('KRSXG5CTMVRXEZLUKN2XAZLSKNSWG4TFOQ');
    await waitFor(async () => (await page.eval<string>(`document.getElementById('codigo').value`)) === newCode, 'código de confirmação preenchido');
    page.close();
  });

  it('sem QR code na página: cola a chave; chave inválida mostra erro', async () => {
    await open('/autenticador', 'Autenticador');
    await app.send({ type: 'totp:scan' });
    const s = await app.until((x) => x.totpSetup !== null, 'janela', 10_000);
    expect(s.totpSetup!.found).toBeNull();
    await app.send({ type: 'totp:setup-answer', setupId: s.totpSetup!.id, target: 'new', secret: '123456' });
    await app.until((x) => Boolean(x.totpSetup?.error), 'erro de chave');
    await app.send({ type: 'totp:setup-answer', setupId: s.totpSetup!.id, target: 'new', secret: 'jbsw y3dp ehpk 3pxp' });
    await app.until((x) => x.totpSetup === null, 'salvou');
    const post = bw.writes.find((w) => w.method === 'POST')!;
    expect(post.body.login.totp).toBeTruthy();
  });
});
