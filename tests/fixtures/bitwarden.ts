// Conta/cofre sintéticos cifrados como o Bitwarden faz (testes sem servidor real).
// A compatibilidade com o Bitwarden de verdade é provada em tests/interop.
import crypto from 'node:crypto';
import { encrypt, makeAccountKeys, makeMasterKey, symKeyFrom, type Kdf, type SymKey } from '../../src/main/vault/crypto';

export interface FixtureLogin { name: string; username: string; password: string; uris: { uri: string; match?: number | null }[]; totp?: string }

export const FIXTURE_EMAIL = 'pessoa@apollo.local';
export const FIXTURE_PASSWORD = 'senha mestra de teste';
export const FIXTURE_KDF: Kdf = { type: 0, iterations: 5000 };

export async function makeFixture(logins: FixtureLogin[]) {
  const masterKey = await makeMasterKey(FIXTURE_PASSWORD, FIXTURE_EMAIL, FIXTURE_KDF);
  const acc = makeAccountKeys(masterKey);
  const cipher = (l: FixtureLogin, i: number, key: SymKey) => ({
    id: `item-${i}`, type: 1, name: encrypt(l.name, key), organizationId: null,
    login: {
      username: encrypt(l.username, key), password: encrypt(l.password, key), totp: l.totp ? encrypt(l.totp, key) : null,
      uris: l.uris.map((u) => ({ uri: encrypt(u.uri, key), match: u.match ?? null })),
    },
  });
  const sync = {
    profile: { id: 'user-1', email: FIXTURE_EMAIL, key: acc.protectedUserKey, privateKey: acc.encryptedPrivateKey, organizations: [] },
    ciphers: logins.map((l, i) => cipher(l, i, acc.userKey)),
  };
  const token = { access_token: 'token-de-teste', expires_in: 3600, Key: acc.protectedUserKey, PrivateKey: acc.encryptedPrivateKey,
    Kdf: FIXTURE_KDF.type, KdfIterations: FIXTURE_KDF.iterations };
  return { sync, token, masterKey, userKey: acc.userKey };
}

export const randomKey = () => symKeyFrom(crypto.randomBytes(64));
