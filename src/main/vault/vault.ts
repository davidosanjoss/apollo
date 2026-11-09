// Cofre desbloqueado em memória. Fica CIFRADO: só nome, usuário e URLs são
// decifrados (para listar e casar com o site). Senha e TOTP são decifrados na
// hora do uso. lock() zera as chaves.
import { field } from './api';
import {
  decrypt, decryptString, rsaDecrypt, stretchMasterKey, symKeyFrom, wipe, VaultCryptoError, type SymKey,
} from './crypto';

export interface LoginUri { uri: string; match: number | null }

export interface VaultLogin {
  id: string;
  name: string;
  username: string | null;
  uris: LoginUri[];
  hasTotp: boolean;
  organizationId: string | null;
}

interface StoredCipher {
  key: SymKey;
  password: string | null;
  totp: string | null;
}

const CIPHER_LOGIN = 1;

export class UnlockedVault {
  private constructor(
    private readonly keys: SymKey[],
    private readonly secrets: Map<string, StoredCipher>,
    readonly logins: VaultLogin[],
    /** Itens que não deu para abrir (chave errada, formato desconhecido): não derrubam o resto. */
    readonly skipped: number,
  ) {}

  /** Abre o cofre: chave mestra → chave do usuário → (chave privada → chaves das organizações) → itens. */
  static open(sync: unknown, masterKey: Buffer, protectedUserKey?: string | null): UnlockedVault {
    const profile = field(sync, 'profile');
    const encUserKey = protectedUserKey ?? field<string>(profile, 'key');
    if (!encUserKey) throw new VaultCryptoError('cofre sem chave do usuário');

    const stretched = stretchMasterKey(masterKey);
    let userKey: SymKey;
    try {
      userKey = symKeyFrom(decrypt(encUserKey, stretched));
    } catch {
      throw new VaultCryptoError('senha mestra incorreta');
    } finally {
      wipe(stretched);
    }

    const keys: SymKey[] = [userKey];
    const orgKeys = new Map<string, SymKey>();
    const encPrivate = field<string>(profile, 'privateKey');
    const orgs = field<unknown[]>(profile, 'organizations') ?? [];
    if (encPrivate && orgs.length) {
      const privateDer = decrypt(encPrivate, userKey);
      try {
        for (const org of orgs) {
          const id = field<string>(org, 'id');
          const k = field<string>(org, 'key');
          if (!id || !k) continue;
          try {
            const key = symKeyFrom(rsaDecrypt(k, privateDer));
            orgKeys.set(id, key);
            keys.push(key);
          } catch { /* organização ilegível: seus itens serão pulados */ }
        }
      } finally {
        privateDer.fill(0);
      }
    }

    const secrets = new Map<string, StoredCipher>();
    const logins: VaultLogin[] = [];
    let skipped = 0;
    for (const c of field<unknown[]>(sync, 'ciphers') ?? []) {
      if (field(c, 'type') !== CIPHER_LOGIN || field(c, 'deletedDate')) continue;
      try {
        const orgId = field<string>(c, 'organizationId') ?? null;
        const owner = orgId ? orgKeys.get(orgId) : userKey;
        if (!owner) throw new VaultCryptoError('organização sem chave');
        // Itens novos têm a própria chave (cifrada com a do dono).
        const ownKey = field<string>(c, 'key');
        const key = ownKey ? symKeyFrom(decrypt(ownKey, owner)) : owner;
        if (ownKey) keys.push(key);
        const dec = (v: unknown) => (typeof v === 'string' && v ? decryptString(v, key) : null);
        const login = field(c, 'login');
        const id = field<string>(c, 'id')!;
        logins.push({
          id,
          name: dec(field(c, 'name')) ?? '',
          username: dec(field(login, 'username')),
          uris: (field<unknown[]>(login, 'uris') ?? []).flatMap((u) => {
            const uri = dec(field(u, 'uri'));
            return uri ? [{ uri, match: field<number | null>(u, 'match') ?? null }] : [];
          }),
          hasTotp: Boolean(field(login, 'totp')),
          organizationId: orgId,
        });
        secrets.set(id, { key, password: field<string>(login, 'password') ?? null, totp: field<string>(login, 'totp') ?? null });
      } catch {
        skipped++;
      }
    }
    return new UnlockedVault(keys, secrets, logins, skipped);
  }

  /** Decifra a senha na hora (não fica guardada em texto). */
  password(id: string): string | null {
    const s = this.secrets.get(id);
    return s?.password ? decryptString(s.password, s.key) : null;
  }

  totpSecret(id: string): string | null {
    const s = this.secrets.get(id);
    return s?.totp ? decryptString(s.totp, s.key) : null;
  }

  lock(): void {
    for (const k of this.keys) wipe(k);
    this.secrets.clear();
    this.logins.length = 0;
  }
}
