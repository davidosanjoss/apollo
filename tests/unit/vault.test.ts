import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, decryptString, encrypt, makeAccountKeys, makeMasterKey, rsaEncrypt, stretchMasterKey, symKeyFrom } from '../../src/main/vault/crypto';
import { UnlockedVault } from '../../src/main/vault/vault';

/** Monta um /sync sintético cifrado como o Bitwarden faz. */
async function fixture() {
  const masterKey = await makeMasterKey('senha', 'a@b.c', { type: 0, iterations: 5000 });
  const acc = makeAccountKeys(masterKey);
  const uk = acc.userKey;
  const orgRaw = crypto.randomBytes(64);
  const orgKey = symKeyFrom(orgRaw);
  const itemRaw = crypto.randomBytes(64);
  const itemKey = symKeyFrom(itemRaw);
  const login = (key: typeof uk, name: string, extra: object = {}) => ({
    type: 1, name: encrypt(name, key),
    login: { username: encrypt(`${name}-user`, key), password: encrypt(`${name}-pass`, key), uris: [{ uri: encrypt(`https://${name}.com`, key), match: 1 }] },
    ...extra,
  });
  const sync = {
    profile: {
      key: acc.protectedUserKey,
      privateKey: acc.encryptedPrivateKey,
      organizations: [{ id: 'org1', key: rsaEncrypt(orgRaw, Buffer.from(acc.publicKey, 'base64')) }],
    },
    ciphers: [
      { id: 'c1', ...login(uk, 'pessoal'), login: { ...login(uk, 'pessoal').login, totp: encrypt('JBSWY3DPEHPK3PXP', uk) } },
      { id: 'c2', ...login(itemKey, 'propria', { key: encrypt(itemRaw, uk) }) },
      { id: 'c3', organizationId: 'org1', ...login(orgKey, 'faculdade') },
      { id: 'c4', ...login(uk, 'lixeira'), deletedDate: '2026-01-01' },
      { id: 'c5', type: 2, name: encrypt('nota', uk) },
      { id: 'c6', ...login(symKeyFrom(crypto.randomBytes(64)), 'corrompido') },
      { id: 'c7', organizationId: 'org-sem-chave', ...login(orgKey, 'orfao') },
    ],
  };
  return { sync, masterKey };
}

describe('UnlockedVault', () => {
  it('abre logins pessoais, com chave própria e de organização', async () => {
    const { sync, masterKey } = await fixture();
    const v = UnlockedVault.open(sync, masterKey);
    expect(v.logins.map((l) => l.name).sort()).toEqual(['faculdade', 'pessoal', 'propria']);
    const byName = Object.fromEntries(v.logins.map((l) => [l.name, l]));
    expect(byName.pessoal).toMatchObject({ username: 'pessoal-user', hasTotp: true, uris: [{ uri: 'https://pessoal.com', match: 1 }] });
    expect(byName.faculdade.organizationId).toBe('org1');
    expect(v.password(byName.propria.id)).toBe('propria-pass');
    expect(v.password(byName.faculdade.id)).toBe('faculdade-pass');
    expect(v.totpSecret(byName.pessoal.id)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('item ilegível não derruba o cofre; lixeira e não-login ficam de fora', async () => {
    const { sync, masterKey } = await fixture();
    const v = UnlockedVault.open(sync, masterKey);
    expect(v.skipped).toBe(2); // corrompido + organização sem chave
    expect(v.logins.some((l) => l.name === 'lixeira' || l.name === 'nota')).toBe(false);
  });

  it('senha mestra errada', async () => {
    const { sync } = await fixture();
    const wrong = await makeMasterKey('outra', 'a@b.c', { type: 0, iterations: 5000 });
    expect(() => UnlockedVault.open(sync, wrong)).toThrow(/senha mestra incorreta/);
  });

  it('senhas não ficam em texto na lista; lock limpa tudo', async () => {
    const { sync, masterKey } = await fixture();
    const v = UnlockedVault.open(sync, masterKey);
    expect(JSON.stringify(v.logins)).not.toContain('-pass');
    const id = v.logins[0].id;
    v.lock();
    expect(v.logins).toEqual([]);
    expect(v.password(id)).toBeNull();
  });

  // Regressão: itens criados pelo Apollo saíam sem uriChecksum e os clientes oficiais
  // descartavam a URL. E uma URL adulterada no servidor não pode valer.
  it('uriChecksum: gravado ao criar; URL com checksum que não bate é ignorada', async () => {
    const { sync, masterKey } = await fixture();
    const v = UnlockedVault.open(sync, masterKey);
    const body = v.newLoginRequest({ name: 'n', username: 'u', password: 'p', uri: 'https://banco.com' }) as any;
    const uk = symKeyFrom(decrypt(sync.profile.key, stretchMasterKey(masterKey)));
    const key = symKeyFrom(decrypt(body.key, uk));
    expect(decryptString(body.login.uris[0].uriChecksum, key)).toBe(crypto.createHash('sha256').update('https://banco.com').digest('base64'));

    const pessoal = sync.ciphers[0] as any;
    pessoal.login.uris = [
      { uri: encrypt('https://golpe.com', uk), uriChecksum: encrypt(crypto.createHash('sha256').update('https://pessoal.com').digest('base64'), uk), match: null },
      { uri: encrypt('https://pessoal.com', uk), uriChecksum: encrypt(crypto.createHash('sha256').update('https://pessoal.com').digest('base64'), uk), match: null },
    ];
    const v2 = UnlockedVault.open(sync, masterKey);
    expect(v2.logins.find((l) => l.id === 'c1')!.uris.map((u) => u.uri)).toEqual(['https://pessoal.com']);
  });
});
