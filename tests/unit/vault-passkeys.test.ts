import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encrypt, makeAccountKeys, makeMasterKey, type SymKey } from '../../src/main/vault/crypto';
import { UnlockedVault, type NewPasskey } from '../../src/main/vault/vault';
import { makeAssertion } from '../../src/main/vault/webauthn';

const GUID = '6e1b5a3c-2d4f-4a8b-9c0d-1e2f3a4b5c6d';

/** Passkey como o Bitwarden guarda (tudo cifrado com a chave do item, menos a data). */
function storedPasskey(key: SymKey, pkcs8: Buffer, over: Record<string, string | null> = {}) {
  const v: Record<string, string | null> = { credentialId: GUID, keyType: 'public-key', keyAlgorithm: 'ECDSA', keyCurve: 'P-256',
    keyValue: pkcs8.toString('base64url'), rpId: 'exemplo.com', userHandle: Buffer.from('id-do-usuario').toString('base64url'),
    userName: 'eu@exemplo.com', counter: '0', rpName: 'Exemplo', userDisplayName: 'Eu', discoverable: 'true', ...over };
  return { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === null ? null : encrypt(x, key)])), creationDate: '2026-01-01T00:00:00.000Z' };
}

async function setup() {
  const masterKey = await makeMasterKey('senha', 'a@b.c', { type: 0, iterations: 5000 });
  const acc = makeAccountKeys(masterKey);
  const uk = acc.userKey;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const login = (name: string, extra: object = {}) => ({
    type: 1, name: encrypt(name, uk), revisionDate: '2026-02-02T00:00:00.000Z', notes: encrypt('nota secreta', uk),
    login: { username: encrypt('eu@exemplo.com', uk), password: encrypt('senha-antiga', uk), uris: [{ uri: encrypt('https://exemplo.com', uk), match: null }], ...extra },
  });
  const sync = {
    profile: { id: 'user-1', key: acc.protectedUserKey, privateKey: acc.encryptedPrivateKey, organizations: [] },
    ciphers: [
      { id: 'com-passkey', ...login('Exemplo', { fido2Credentials: [storedPasskey(uk, pkcs8)] }) },
      { id: 'sem-passkey', ...login('Outro') },
      { id: 'passkey-ruim', ...login('Ruim', { fido2Credentials: [{ credentialId: 'lixo', rpId: 'lixo' }] }) },
    ],
  };
  return { sync, masterKey, publicKey, pkcs8, acc };
}

const passkey = (over: Partial<NewPasskey> = {}): NewPasskey => ({
  credentialId: GUID.replace('6e1b', 'aaaa'), privateKey: crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'der', type: 'pkcs8' }),
  rpId: 'novo.com', rpName: 'Novo', userHandle: Buffer.from('h'), userName: 'nova@pessoa.com', userDisplayName: 'Nova', discoverable: true, ...over,
});

describe('passkeys no cofre do Bitwarden', () => {
  it('lê as passkeys do login; a chave privada só sai decifrada sob pedido', async () => {
    const { sync, masterKey, publicKey } = await setup();
    const v = UnlockedVault.open(sync, masterKey);
    expect(v.logins.find((l) => l.id === 'com-passkey')!.passkeys).toEqual([
      { credentialId: GUID, rpId: 'exemplo.com', userName: 'eu@exemplo.com', userDisplayName: 'Eu', discoverable: true, counter: 0 }]);
    expect(v.logins.find((l) => l.id === 'sem-passkey')!.passkeys).toEqual([]);
    expect(v.logins.find((l) => l.id === 'passkey-ruim')!.passkeys).toEqual([]); // ilegível: o login continua
    const secret = v.passkeySecret('com-passkey', GUID)!;
    expect(secret.userHandle!.toString()).toBe('id-do-usuario');
    // A chave guardada assina logins que conferem com a pública do site.
    const as = makeAssertion({ privateKeyPkcs8: secret.privateKey, credentialId: Buffer.alloc(16), userHandle: null, rpId: 'exemplo.com',
      origin: 'https://exemplo.com', challenge: Buffer.from('c'), counter: 0, uv: true });
    const signed = Buffer.concat([as.authenticatorData, crypto.createHash('sha256').update(as.clientDataJSON).digest()]);
    expect(crypto.verify('sha256', signed, { key: publicKey, dsaEncoding: 'der' }, as.signature)).toBe(true);
    expect(v.passkeySecret('com-passkey', 'outro-id')).toBeNull();
  });

  it('passkey nova num login existente: o resto do item vai como veio (senha, notas)', async () => {
    const { sync, masterKey } = await setup();
    const v = UnlockedVault.open(sync, masterKey);
    const p = passkey({ rpId: 'exemplo.com' });
    const body = v.passkeyUpdateRequest('sem-passkey', p) as any;
    const raw = sync.ciphers[1] as any;
    expect(body.login.password).toBe(raw.login.password);
    expect(body.notes).toBe(raw.notes);
    expect(body.lastKnownRevisionDate).toBe('2026-02-02T00:00:00.000Z');
    expect(body.encryptedFor).toBe('user-1');
    // O servidor guardaria assim: abrindo de novo, a passkey está lá e assina.
    const v2 = UnlockedVault.open({ ...sync, ciphers: [{ ...raw, ...body, id: 'sem-passkey' }] }, masterKey);
    expect(v2.logins[0].passkeys).toEqual([{ credentialId: p.credentialId, rpId: 'exemplo.com', userName: 'nova@pessoa.com',
      userDisplayName: 'Nova', discoverable: true, counter: 0 }]);
    expect(v2.passkeySecret('sem-passkey', p.credentialId)!.privateKey).toEqual(p.privateKey);
    expect(v2.password('sem-passkey')).toBe('senha-antiga');
  });

  it('login novo só com a passkey (sem senha), com o site e o usuário', async () => {
    const { sync, masterKey } = await setup();
    const v = UnlockedVault.open(sync, masterKey);
    const p = passkey();
    const body = v.newPasskeyLoginRequest('novo.com', 'https://novo.com', p) as any;
    expect(body.login.password).toBeNull();
    const v2 = UnlockedVault.open({ ...sync, ciphers: [{ ...body, id: 'n1' }] }, masterKey);
    expect(v2.logins[0]).toMatchObject({ name: 'novo.com', username: 'nova@pessoa.com', uris: [{ uri: 'https://novo.com', match: null }] });
    expect(v2.logins[0].passkeys[0].rpId).toBe('novo.com');
    expect(v2.passkeySecret('n1', p.credentialId)!.userHandle!.toString()).toBe('h');
  });

  it('contador: só a passkey certa muda', async () => {
    const { sync, masterKey } = await setup();
    const v = UnlockedVault.open(sync, masterKey);
    const body = v.passkeyCounterRequest('com-passkey', GUID, 5) as any;
    const v2 = UnlockedVault.open({ ...sync, ciphers: [{ ...sync.ciphers[0], ...body, id: 'com-passkey' }] }, masterKey);
    expect(v2.logins[0].passkeys[0].counter).toBe(5);
  });
});

describe('app autenticador no cofre', () => {
  it('põe o segredo TOTP num login existente sem mexer no resto', async () => {
    const { sync, masterKey } = await setup();
    const v = UnlockedVault.open(sync, masterKey);
    const body = v.totpUpdateRequest('sem-passkey', 'JBSWY3DPEHPK3PXP') as any;
    const raw = sync.ciphers[1] as any;
    expect(body.login.password).toBe(raw.login.password);
    const v2 = UnlockedVault.open({ ...sync, ciphers: [{ ...raw, ...body, id: 'sem-passkey' }] }, masterKey);
    expect(v2.logins[0].hasTotp).toBe(true);
    expect(v2.totpSecret('sem-passkey')).toBe('JBSWY3DPEHPK3PXP');
    expect(v2.password('sem-passkey')).toBe('senha-antiga');
  });

  it('login novo com o autenticador', async () => {
    const { sync, masterKey } = await setup();
    const v = UnlockedVault.open(sync, masterKey);
    const body = v.newLoginRequest({ name: 'n', username: 'u', password: '', uri: 'https://n.com', totp: 'JBSWY3DPEHPK3PXP' }) as any;
    const v2 = UnlockedVault.open({ ...sync, ciphers: [{ ...body, id: 'x' }] }, masterKey);
    expect(v2.totpSecret('x')).toBe('JBSWY3DPEHPK3PXP');
  });
});
