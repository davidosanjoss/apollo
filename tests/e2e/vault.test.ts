// Fase 4b: cofre do Bitwarden no Apollo (servidor falso; compatibilidade real em tests/interop).
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_PASSWORD, makeFixture } from '../fixtures/bitwarden';
import { Apollo, startFakeBitwarden, tempProfile, waitFor } from './harness';

const SECRET = 'segredo-da-api-xyz';
let bw: Awaited<ReturnType<typeof startFakeBitwarden>>;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;

beforeAll(async () => {
  const fx = await makeFixture([
    { name: 'Outlook', username: 'eu@empresa.com', password: 'senha-outlook', uris: [{ uri: 'https://outlook.office.com' }] },
    { name: 'Moodle', username: 'aluno', password: 'senha-moodle', uris: [{ uri: 'https://moodle.ufmg.br' }] },
  ]);
  bw = await startFakeBitwarden(SECRET, fx.token, fx.sync);
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
});
afterAll(async () => {
  await app?.quit();
  await bw?.close();
  profile?.cleanup();
});

const field = (sel: string, value: string) => app.ui.eval(`(() => { const e = document.querySelector('${sel}'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change')); return true; })()`);
const submit = () => app.ui.eval(`document.getElementById('vault-form').requestSubmit(); true`);

describe('cofre do Bitwarden', () => {
  it('conectar pela interface: chave de API + senha mestra', async () => {
    expect((await app.state()).vault.status).toBe('disconnected');
    await app.ui.mouseClick('#vault-btn');
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('vault-dialog').open`), 'diálogo');
    await field('#vault-server', 'custom');
    await field('#vault-custom', bw.url);
    await field('#vault-client-id', 'user.1234-abcd');
    await field('#vault-client-secret', SECRET);
    await field('#vault-connect-password', FIXTURE_PASSWORD);
    await submit();
    const s = await app.until((x) => x.vault.status === 'unlocked', 'desbloqueado', 15_000);
    expect(s.vault).toMatchObject({ email: 'pessoa@apollo.local', server: bw.url.replace('http://', ''), count: 2, error: null });
    // Segredos saem dos campos e nunca aparecem no estado da interface.
    expect(await app.ui.eval(`document.getElementById('vault-client-secret').value + document.getElementById('vault-connect-password').value`)).toBe('');
    expect(JSON.stringify(s)).not.toContain(SECRET);
    expect(JSON.stringify(s)).not.toContain(FIXTURE_PASSWORD);
    expect(await app.ui.eval(`document.getElementById('vault-btn').classList.contains('unlocked')`)).toBe(true);
  });

  it('nada sensível em claro no disco', async () => {
    await app.send({ type: 'vault:lock' });
    await app.until((x) => x.vault.status === 'locked', 'bloqueado');
    const files = [path.join(profile.dir, 'apollo.db'), path.join(profile.dir, 'apollo.db-wal')].filter((f) => fs.existsSync(f));
    const bytes = Buffer.concat(files.map((f) => fs.readFileSync(f)));
    for (const s of [SECRET, FIXTURE_PASSWORD, 'senha-outlook', 'eu@empresa.com']) expect(bytes.includes(Buffer.from(s)), s).toBe(false);
  });

  it('senha mestra errada: erro; certa: desbloqueia', async () => {
    await app.send({ type: 'vault:unlock', password: 'errada' });
    await app.until((x) => x.vault.error === 'senha mestra incorreta', 'erro');
    await app.send({ type: 'vault:unlock', password: FIXTURE_PASSWORD });
    await app.until((x) => x.vault.status === 'unlocked' && x.vault.error === null, 'desbloqueado');
  });

  it('reabrir o Apollo: começa bloqueado; desbloqueia mesmo com o servidor fora do ar', async () => {
    await app.quit();
    await bw.close();
    app = await Apollo.launch(profile.dir);
    expect((await app.state()).vault.status).toBe('locked');
    await app.send({ type: 'vault:unlock', password: FIXTURE_PASSWORD });
    const s = await app.until((x) => x.vault.status === 'unlocked' && !x.vault.busy, 'desbloqueado offline', 15_000);
    expect(s.vault.count).toBe(2);
  });

  it('desconectar esquece a conta (inclusive depois de reabrir)', async () => {
    await app.send({ type: 'vault:disconnect' });
    await app.until((x) => x.vault.status === 'disconnected', 'desconectado');
    await app.quit();
    app = await Apollo.launch(profile.dir);
    expect((await app.state()).vault.status).toBe('disconnected');
  });
});
