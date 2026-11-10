import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitwardenApi, serverUrls } from '../../src/main/vault/api';
import { hashMasterPassword, makeMasterKey, type Kdf } from '../../src/main/vault/crypto';
import { UnlockedVault } from '../../src/main/vault/vault';
import { BwCli, createOrganization, ensureBwCli, getApiKey, registerAccount, startVaultwarden, type Server } from './harness';

let server: Server;
let bwBin: string;
const device = { id: '6f1c2b1a-1111-4222-8333-944455556666', name: 'Apollo (teste)', type: 14 };

beforeAll(async () => {
  bwBin = ensureBwCli();
  server = await startVaultwarden();
});
afterAll(() => server?.stop());

const api = () => new BitwardenApi(serverUrls(server.url), (u, i) => fetch(u, i), device);

for (const [label, kdf] of [
  ['PBKDF2 600.000', { type: 0, iterations: 600_000 }],
  ['Argon2id', { type: 1, iterations: 3, memory: 64, parallelism: 4 }],
] as [string, Kdf][]) {
  describe(`conta ${label}`, () => {
    const email = `conta-${kdf.type}@apollo.local`;
    const password = 'senha mestra forte 123 ç';
    let created: Awaited<ReturnType<typeof registerAccount>>;
    let bw: BwCli;

    it('conta criada pelo Apollo abre no CLI oficial', async () => {
      created = await registerAccount(server, email, password, kdf);
      bw = new BwCli(bwBin, server);
      bw.login(email, password);
      expect(bw.status()).toBe('unlocked');
    });

    it('itens criados pelo CLI oficial abrem no Apollo (chave de API + senha mestra)', async () => {
      bw.createItem({ type: 1, name: 'Outlook Trabalho', login: { username: 'davi@empresa.com', password: 'S3nh@-Trab!',
        totp: 'JBSWY3DPEHPK3PXP', uris: [{ uri: 'https://outlook.office.com/mail/', match: null }] } });
      bw.createItem({ type: 1, name: 'Moodle', login: { username: 'aluno', password: 'çãõ ✓ unicode', uris: [{ uri: 'https://moodle.ufmg.br', match: 0 }] } });
      bw.createItem({ type: 2, name: 'Nota segura', secureNote: { type: 0 }, notes: 'não é login' });

      // Pegar a chave de API como o usuário faria no cofre web.
      const hash = hashMasterPassword(created.masterKey, password);
      const pw = await api().loginPassword(email, hash);
      const sync0 = await api().sync(pw.accessToken) as { profile: { id: string } };
      const clientSecret = await getApiKey(server, pw.accessToken, hash);

      // O fluxo do Apollo: chave de API → token → sync → senha mestra só local.
      const token = await api().loginApiKey(`user.${sync0.profile.id}`, clientSecret);
      expect(token.kdf).toEqual(kdf);
      const sync = await api().sync(token.accessToken);
      const masterKey = await makeMasterKey(password, email, token.kdf!);
      const vault = UnlockedVault.open(sync, masterKey, token.key);

      expect(vault.skipped).toBe(0);
      const byName = Object.fromEntries(vault.logins.map((l) => [l.name, l]));
      expect(Object.keys(byName).sort()).toEqual(['Moodle', 'Outlook Trabalho']); // nota segura não é login
      expect(byName['Outlook Trabalho']).toMatchObject({ username: 'davi@empresa.com', hasTotp: true,
        uris: [{ uri: 'https://outlook.office.com/mail/', match: null }] });
      expect(byName.Moodle.uris).toEqual([{ uri: 'https://moodle.ufmg.br', match: 0 }]);
      expect(vault.password(byName['Outlook Trabalho'].id)).toBe('S3nh@-Trab!');
      expect(vault.password(byName.Moodle.id)).toBe('çãõ ✓ unicode');
      expect(vault.totpSecret(byName['Outlook Trabalho'].id)).toBe('JBSWY3DPEHPK3PXP');

      vault.lock();
      expect(vault.logins).toEqual([]);
      expect(vault.password(byName.Moodle.id)).toBeNull();
    });

    it('senha mestra errada: recusada localmente', async () => {
      const hash = hashMasterPassword(created.masterKey, password);
      const t = await api().loginPassword(email, hash);
      const sync = await api().sync(t.accessToken);
      const wrong = await makeMasterKey('senha errada', email, kdf);
      expect(() => UnlockedVault.open(sync, wrong, t.key)).toThrow(/senha mestra incorreta/);
    });
  });
}

describe('gravação: o CLI oficial lê o que o Apollo grava', () => {
  const email = 'grava@apollo.local';
  const password = 'senha mestra de gravação 789';
  const kdf: Kdf = { type: 0, iterations: 600_000 };
  let bw: BwCli;
  let token: string;
  let masterKey: Buffer;

  const openVault = async () => UnlockedVault.open(await api().sync(token), masterKey, null);

  it('login novo criado pelo Apollo aparece certo no CLI oficial', async () => {
    const created = await registerAccount(server, email, password, kdf);
    masterKey = created.masterKey;
    token = (await api().loginPassword(email, hashMasterPassword(masterKey, password))).accessToken;
    bw = new BwCli(bwBin, server);
    bw.login(email, password);

    const vault = await openVault();
    await api().createCipher(token, vault.newLoginRequest({ name: 'portal.ufmg.br', username: 'matricula', password: 'nova-s3nha!', uri: 'https://portal.ufmg.br' }));
    const item = bw.listItems().find((i) => i.name === 'portal.ufmg.br')!;
    expect(item.login).toMatchObject({ username: 'matricula', password: 'nova-s3nha!', uris: [{ uri: 'https://portal.ufmg.br' }] });
    // Item com chave própria (a saída do CLI não mostra o campo: confere no /sync cru).
    const raw = ((await api().sync(token)) as { ciphers: { id: string; key?: string }[] }).ciphers.find((c) => c.id === item.id)!;
    expect(raw.key).toMatch(/^2\./);
  });

  it('atualizar a senha preserva notas, campos, TOTP e guarda a antiga no histórico', async () => {
    bw.createItem({ type: 1, name: 'Banco', notes: 'agência 1234', fields: [{ name: 'PIN', value: '9876', type: 1 }],
      login: { username: 'eu', password: 'senha-velha', totp: 'JBSWY3DPEHPK3PXP', uris: [{ uri: 'https://banco.com.br' }] } });
    const vault = await openVault();
    const banco = vault.logins.find((l) => l.name === 'Banco')!;
    await api().updateCipher(token, banco.id, vault.passwordUpdateRequest(banco.id, 'senha-nova')!);

    const item = bw.getItem(banco.id);
    expect(item.login.password).toBe('senha-nova');
    expect(item.login.username).toBe('eu');
    expect(item.login.totp).toBe('JBSWY3DPEHPK3PXP');
    expect(item.notes).toBe('agência 1234');
    expect(item.fields).toMatchObject([{ name: 'PIN', value: '9876', type: 1 }]);
    expect(item.passwordHistory?.[0]?.password).toBe('senha-velha');
    // E o próprio Apollo lê o resultado.
    expect((await openVault()).password(banco.id)).toBe('senha-nova');
  });
});

describe('organização (chave RSA)', () => {
  it('item de organização criado pelo CLI oficial abre no Apollo', async () => {
    const email = 'org@apollo.local';
    const password = 'outra senha mestra 456';
    const kdf: Kdf = { type: 0, iterations: 600_000 };
    const created = await registerAccount(server, email, password, kdf);
    const t = await api().loginPassword(email, hashMasterPassword(created.masterKey, password));
    const orgId = await createOrganization(server, t.accessToken, created.keys.publicKey);

    const bw = new BwCli(bwBin, server);
    bw.login(email, password);
    const [collection] = bw.collections(orgId);
    bw.createItem({ type: 1, name: 'Portal da Faculdade', organizationId: orgId, collectionIds: [collection.id],
      login: { username: 'matricula123', password: 'org-senha!', uris: [{ uri: 'https://portal.ufmg.br' }] } });

    const sync = await api().sync(t.accessToken);
    const vault = UnlockedVault.open(sync, await makeMasterKey(password, email, kdf), t.key);
    const item = vault.logins.find((l) => l.name === 'Portal da Faculdade')!;
    expect(item).toMatchObject({ organizationId: orgId, username: 'matricula123' });
    expect(vault.password(item.id)).toBe('org-senha!');
  });
});

describe('erros', () => {
  it('chave de API errada: credenciais inválidas', async () => {
    await expect(api().loginApiKey('user.00000000-0000-0000-0000-000000000000', 'errada')).rejects.toMatchObject({ code: 'invalid-credentials' });
  });
});
