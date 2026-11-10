import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BitwardenError } from '../../src/main/vault/api';
import { VaultService, type SecretBox, type VaultStorage } from '../../src/main/vault/service';
import { FIXTURE_PASSWORD, makeFixture } from '../fixtures/bitwarden';

let fx: Awaited<ReturnType<typeof makeFixture>>;
beforeEach(async () => {
  fx = await makeFixture([{ name: 'Outlook', username: 'eu@x.com', password: 'p1', uris: [{ uri: 'https://outlook.office.com' }] }]);
});

function memoryStorage(): VaultStorage & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return {
    raw,
    getAccount: () => (raw.get('account') as string) ?? null,
    setAccount: (j) => (j === null ? raw.delete('account') : raw.set('account', j)),
    getSecret: (n) => (raw.get(n) as Buffer) ?? null,
    setSecret: (n, d) => (d === null ? raw.delete(n) : raw.set(n, d)),
  };
}

// "Chaveiro" de teste: inverte os bytes (o importante é não ficar em claro).
const box: SecretBox = { encrypt: async (s) => Buffer.from(s).reverse(), decrypt: async (b) => Buffer.from(b).reverse().toString() };

function setup(opts: { box?: SecretBox | null; online?: boolean } = {}) {
  const storage = memoryStorage();
  const api = {
    loginApiKey: vi.fn(async (_id: string, secret: string) => {
      if (opts.online === false) throw new BitwardenError('network', 'sem conexão');
      if (secret !== 'segredo') throw new BitwardenError('invalid-credentials', 'credenciais inválidas');
      return { accessToken: 't', expiresIn: 3600, key: fx.token.Key, privateKey: fx.token.PrivateKey, kdf: { type: 0 as const, iterations: 5000 } };
    }),
    sync: vi.fn(async () => fx.sync),
    createCipher: vi.fn(async (_t: string, _body: object) => ({})),
    updateCipher: vi.fn(async (_t: string, _id: string, _body: object) => ({})),
  };
  const onChange = vi.fn();
  const make = () => new VaultService(storage, opts.box === undefined ? box : opts.box, () => api, onChange, () => 'device-1');
  return { storage, api, onChange, make, svc: make() };
}

describe('VaultService', () => {
  it('conectar: desbloqueia, salva conta e segredos cifrados (nunca em claro)', async () => {
    const { svc, storage } = setup();
    expect(svc.info().status).toBe('disconnected');
    expect(await svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD)).toBe(true);
    expect(svc.info()).toMatchObject({ status: 'unlocked', email: 'pessoa@apollo.local', server: 'bitwarden.com', count: 1, error: null });
    const all = JSON.stringify([...storage.raw.values()].map((v) => (Buffer.isBuffer(v) ? v.toString('latin1') : v)));
    expect(all).not.toContain('segredo');
    expect(all).not.toContain(FIXTURE_PASSWORD);
    expect(storage.getAccount()).not.toContain('segredo');
  });

  it('senha mestra errada na conexão: nada é salvo', async () => {
    const { svc, storage } = setup();
    expect(await svc.connect('us', 'user.1', 'segredo', 'errada')).toBeNull();
    expect(svc.info()).toMatchObject({ status: 'disconnected', error: 'senha mestra incorreta' });
    expect(storage.raw.size).toBe(0);
  });

  it('chave de API errada: mensagem do servidor', async () => {
    const { svc } = setup();
    await svc.connect('us', 'user.1', 'outra', FIXTURE_PASSWORD);
    expect(svc.info().error).toBe('credenciais inválidas');
  });

  it('bloquear e desbloquear (mesmo sem internet, pela cópia local)', async () => {
    const s = setup();
    await s.svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD);
    s.svc.lock();
    expect(s.svc.info().status).toBe('locked');
    expect(s.svc.unlocked).toBeNull();

    // Reinício do app, sem internet.
    const offline = setup({ online: false });
    for (const [k, v] of s.storage.raw) offline.storage.raw.set(k, v);
    const svc2 = offline.make();
    expect(svc2.info().status).toBe('locked');
    expect(await svc2.unlock('errada')).toBeNull();
    expect(svc2.info().error).toBe('senha mestra incorreta');
    expect(await svc2.unlock(FIXTURE_PASSWORD)).toBe(true);
    expect(svc2.unlocked!.password(svc2.unlocked!.logins[0].id)).toBe('p1');
  });

  it('sem chaveiro do sistema: conecta, mas não grava segredo nem cópia', async () => {
    const { svc, storage } = setup({ box: null });
    await svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD);
    expect(svc.info().canRemember).toBe(false);
    expect([...storage.raw.keys()]).toEqual(['account']);
  });

  it('bloqueio automático por tempo ocioso', async () => {
    const { svc } = setup();
    await svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD);
    svc.setLockAfter(5);
    svc.checkIdle(4 * 60);
    expect(svc.info().status).toBe('unlocked');
    svc.checkIdle(5 * 60);
    expect(svc.info().status).toBe('locked');
  });

  it('tempo de bloqueio só aceita opções conhecidas', async () => {
    const { svc } = setup();
    await svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD);
    svc.setLockAfter(7);
    expect(svc.info().lockAfterMin).toBe(15);
  });

  it('sync regrava o segredo com a chave atual do chaveiro (troca de chave não prende o segredo)', async () => {
    const s = setup();
    await s.svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD);
    const before = s.storage.raw.get('clientSecret');
    await s.svc.sync();
    const after = s.storage.raw.get('clientSecret');
    expect(after).not.toBe(before); // gravado de novo (novo Buffer)
    expect(await box.decrypt(after as Buffer)).toBe('segredo');
  });

  it('chaveiro que não decifra mais (chave trocada): desbloqueio cai para o servidor', async () => {
    const s = setup();
    await s.svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD);
    s.svc.lock();
    let failSync = true;
    const flaky: SecretBox = { encrypt: box.encrypt, decrypt: async (b) => {
      const v = await box.decrypt(b);
      if (failSync && v.startsWith('{')) { failSync = false; throw new Error('chave trocada'); }
      return v;
    } };
    const svc2 = new VaultService(s.storage, flaky, () => s.api, () => {}, () => 'device-1');
    expect(await svc2.unlock(FIXTURE_PASSWORD)).toBe(true);
    expect(s.api.sync).toHaveBeenCalledTimes(2); // conexão + este desbloqueio (cópia local ilegível)
  });

  it('salvar login: cria no servidor (cifrado) e sincroniza', async () => {
    const s = setup();
    await s.svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD);
    expect(await s.svc.saveLogin({ name: 'site.com', username: 'eu', password: 'nova', uri: 'https://site.com' })).toBe(true);
    const body = s.api.createCipher.mock.calls[0][1] as Record<string, any>;
    expect(JSON.stringify(body)).not.toContain('nova'); // vai cifrado
    expect(body.encryptedFor).toBe('user-1');
    expect(s.api.sync).toHaveBeenCalledTimes(2);
  });

  it('atualizar senha: troca só a senha e guarda a antiga (cifrada) no histórico', async () => {
    const s = setup();
    await s.svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD);
    const id = s.svc.unlocked!.logins[0].id;
    expect(await s.svc.updatePassword(id, 'senha-nova')).toBe(true);
    const [, sentId, body] = s.api.updateCipher.mock.calls[0] as [string, string, Record<string, any>];
    expect(sentId).toBe(id);
    expect(body.name).toBe(fx.sync.ciphers[0].name); // intocado, ainda cifrado
    expect(body.login.username).toBe(fx.sync.ciphers[0].login.username);
    expect(body.passwordHistory[0].password).toBe(fx.sync.ciphers[0].login.password);
    expect(body.login.password).not.toBe(fx.sync.ciphers[0].login.password);
  });

  it('gravar com o cofre bloqueado: erro claro, nada enviado', async () => {
    const s = setup();
    await s.svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD);
    s.svc.lock();
    expect(await s.svc.saveLogin({ name: 'x', username: null, password: 'p', uri: 'https://x.com' })).toBeNull();
    expect(s.svc.info().error).toBe('desbloqueie o cofre para salvar');
    expect(s.api.createCipher).not.toHaveBeenCalled();
  });

  it('desconectar esquece tudo', async () => {
    const { svc, storage } = setup();
    await svc.connect('us', 'user.1', 'segredo', FIXTURE_PASSWORD);
    svc.disconnect();
    expect(svc.info().status).toBe('disconnected');
    expect(storage.raw.size).toBe(0);
  });
});
