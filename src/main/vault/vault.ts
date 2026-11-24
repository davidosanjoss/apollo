// Cofre desbloqueado em memória. Fica CIFRADO: só nome, usuário e URLs são
// decifrados (para listar e casar com o site). Senha e TOTP são decifrados na
// hora do uso. lock() zera as chaves.
import { field } from './api';
import crypto from 'node:crypto';
import {
  decrypt, decryptString, encrypt, rsaDecrypt, stretchMasterKey, symKeyFrom, wipe, VaultCryptoError, type SymKey,
} from './crypto';

export interface LoginUri { uri: string; match: number | null }

/** Passkey guardada num login (só o que dá para mostrar; a chave privada fica cifrada). */
export interface VaultPasskey {
  /** Como o Bitwarden guarda: GUID, ou "b64.<base64url>". */
  credentialId: string;
  rpId: string;
  userName: string | null;
  userDisplayName: string | null;
  discoverable: boolean;
  counter: number;
}

export interface VaultLogin {
  id: string;
  name: string;
  username: string | null;
  uris: LoginUri[];
  hasTotp: boolean;
  organizationId: string | null;
  passkeys: VaultPasskey[];
}

/** Passkey nova, decifrada (o Apollo cifra com a chave do item ao gravar). */
export interface NewPasskey {
  credentialId: string;
  /** PKCS#8 da chave privada. */
  privateKey: Buffer;
  rpId: string;
  rpName: string | null;
  userHandle: Buffer | null;
  userName: string | null;
  userDisplayName: string | null;
  discoverable: boolean;
}

interface StoredCipher {
  key: SymKey;
  password: string | null;
  totp: string | null;
  /** fido2Credentials como vieram do servidor (cifrados). */
  fido2: unknown[];
  /** Item como veio do servidor (cifrado): base para atualizar sem perder nada. */
  raw: unknown;
}

export interface NewLogin { name: string; username: string | null; password: string; uri: string; match?: number | null }

const PASSWORD_HISTORY_MAX = 5;

/** SHA-256 da URL, em base64 (cifrado, vai em "uriChecksum": detecta URL adulterada). */
const uriChecksum = (uri: string) => crypto.createHash('sha256').update(uri, 'utf8').digest('base64');
const KEEP_ON_UPDATE = ['type', 'organizationId', 'folderId', 'favorite', 'reprompt', 'key', 'name', 'notes', 'fields',
  'secureNote', 'card', 'identity', 'sshKey'];

const CIPHER_LOGIN = 1;

export class UnlockedVault {
  private constructor(
    /** Id do usuário (vai em "encryptedFor" ao gravar: o servidor confere quem cifrou). */
    private readonly userId: string | null,
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
        const fido2 = field<unknown[]>(login, 'fido2Credentials') ?? [];
        const passkeys = fido2.flatMap((f): VaultPasskey[] => {
          try {
            const credentialId = dec(field(f, 'credentialId'));
            const rpId = dec(field(f, 'rpId'));
            if (!credentialId || !rpId) return [];
            return [{ credentialId, rpId, userName: dec(field(f, 'userName')), userDisplayName: dec(field(f, 'userDisplayName')),
              discoverable: dec(field(f, 'discoverable')) === 'true', counter: Number(dec(field(f, 'counter')) ?? 0) || 0 }];
          } catch { return []; } // passkey ilegível: o resto do item continua
        });
        logins.push({
          id,
          name: dec(field(c, 'name')) ?? '',
          username: dec(field(login, 'username')),
          uris: (field<unknown[]>(login, 'uris') ?? []).flatMap((u) => {
            const uri = dec(field(u, 'uri'));
            if (!uri) return [];
            // Como os clientes oficiais: com checksum, a URL só vale se ele bater.
            const sum = dec(field(u, 'uriChecksum'));
            if (sum !== null && sum !== uriChecksum(uri)) return [];
            return [{ uri, match: field<number | null>(u, 'match') ?? null }];
          }),
          hasTotp: Boolean(field(login, 'totp')),
          organizationId: orgId,
          passkeys,
        });
        secrets.set(id, { key, password: field<string>(login, 'password') ?? null, totp: field<string>(login, 'totp') ?? null, fido2, raw: c });
      } catch {
        skipped++;
      }
    }
    return new UnlockedVault(field<string>(profile, 'id') ?? null, keys, secrets, logins, skipped);
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

  /** Chave privada (PKCS#8) e id do usuário de uma passkey, decifrados na hora do uso. */
  passkeySecret(itemId: string, credentialId: string): { privateKey: Buffer; userHandle: Buffer | null } | null {
    const s = this.secrets.get(itemId);
    if (!s) return null;
    for (const f of s.fido2) {
      const dec = (v: unknown) => (typeof v === 'string' && v ? decryptString(v, s.key) : null);
      if (dec(field(f, 'credentialId')) !== credentialId) continue;
      const keyValue = dec(field(f, 'keyValue'));
      if (!keyValue) return null;
      const handle = dec(field(f, 'userHandle'));
      return { privateKey: Buffer.from(keyValue, 'base64url'), userHandle: handle ? Buffer.from(handle, 'base64url') : null };
    }
    return null;
  }

  /** Passkey nova cifrada com a chave do item (formato de login.fido2Credentials). */
  private encryptPasskey(p: NewPasskey, key: SymKey, now: Date): object {
    const enc = (v: string | null) => (v === null || v === '' ? null : encrypt(v, key));
    return {
      credentialId: encrypt(p.credentialId, key), keyType: encrypt('public-key', key), keyAlgorithm: encrypt('ECDSA', key),
      keyCurve: encrypt('P-256', key), keyValue: encrypt(p.privateKey.toString('base64url'), key), rpId: encrypt(p.rpId, key),
      userHandle: p.userHandle ? encrypt(p.userHandle.toString('base64url'), key) : null, userName: enc(p.userName),
      counter: encrypt('0', key), rpName: enc(p.rpName), userDisplayName: enc(p.userDisplayName),
      discoverable: encrypt(String(p.discoverable), key), creationDate: now.toISOString(),
    };
  }

  /** Corpo para criar um login só com a passkey (POST /ciphers). */
  newPasskeyLoginRequest(name: string, uri: string, passkey: NewPasskey, now = new Date()): object {
    const body = this.newLoginRequest({ name, username: passkey.userName, password: '', uri }) as Record<string, any>;
    const key = this.itemKeyOf(body);
    try {
      body.login.fido2Credentials = [this.encryptPasskey(passkey, key, now)];
    } finally {
      wipe(key);
    }
    return body;
  }

  /**
   * Corpo para pôr a passkey num login existente (PUT /ciphers/{id}). Como o Bitwarden, um
   * login tem uma passkey: a nova substitui a anterior (quem chama confere antes). O resto do
   * item vai como veio do servidor.
   */
  passkeyUpdateRequest(itemId: string, passkey: NewPasskey, now = new Date()): object | null {
    const s = this.secrets.get(itemId);
    if (!s) return null;
    const body = this.keptFields(s);
    const login = { ...(field<Record<string, unknown>>(s.raw, 'login') ?? {}) };
    body.login = { ...login, fido2Credentials: [this.encryptPasskey(passkey, s.key, now)] };
    return body;
  }

  /** Contador de uma passkey (só as que contam: contador 0 fica 0, como no Bitwarden). */
  passkeyCounterRequest(itemId: string, credentialId: string, counter: number): object | null {
    const s = this.secrets.get(itemId);
    if (!s) return null;
    const body = this.keptFields(s);
    const login = { ...(field<Record<string, unknown>>(s.raw, 'login') ?? {}) };
    body.login = { ...login, fido2Credentials: s.fido2.map((f) => {
      const id = typeof field(f, 'credentialId') === 'string' ? decryptString(field<string>(f, 'credentialId')!, s.key) : null;
      return id === credentialId ? { ...(f as object), counter: encrypt(String(counter), s.key) } : f;
    }) };
    return body;
  }

  /** Corpo de um PUT com o item como veio do servidor (sem decifrar), pronto para trocar um campo. */
  private keptFields(s: StoredCipher): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    for (const k of KEEP_ON_UPDATE) {
      const v = field(s.raw, k);
      if (v !== undefined) body[k] = v;
    }
    body.passwordHistory = field(s.raw, 'passwordHistory') ?? null;
    body.lastKnownRevisionDate = field(s.raw, 'revisionDate') ?? null;
    body.encryptedFor = this.userId;
    return body;
  }

  /** Chave do item recém-montado por newLoginRequest (decifrada com a do usuário). */
  private itemKeyOf(body: Record<string, any>): SymKey {
    return symKeyFrom(decrypt(body.key as string, this.keys[0]));
  }

  /**
   * Corpo para criar um login (POST /ciphers), cifrado como os clientes atuais:
   * cada item tem a própria chave, cifrada com a chave do usuário.
   */
  newLoginRequest(login: NewLogin): object {
    const userKey = this.keys[0];
    const raw = crypto.randomBytes(64);
    const key = symKeyFrom(raw);
    try {
      const enc = (v: string | null) => (v === null || v === '' ? null : encrypt(v, key));
      return {
        type: 1, organizationId: null, folderId: null, favorite: false, reprompt: 0, notes: null, fields: null,
        encryptedFor: this.userId,
        key: encrypt(raw, userKey),
        name: encrypt(login.name, key),
        login: { username: enc(login.username), password: enc(login.password), totp: null,
          uris: [{ uri: encrypt(login.uri, key), uriChecksum: encrypt(uriChecksum(login.uri), key), match: login.match ?? null }] },
      };
    } finally {
      wipe(key);
      raw.fill(0);
    }
  }

  /**
   * Corpo para trocar SÓ a senha (PUT /ciphers/{id}). O resto do item vai exatamente
   * como veio do servidor, sem ser decifrado (notas, campos, passkeys não se perdem);
   * a senha antiga (já cifrada) vai para o histórico.
   */
  passwordUpdateRequest(id: string, newPassword: string, now = new Date()): object | null {
    const s = this.secrets.get(id);
    if (!s) return null;
    const raw = s.raw as Record<string, unknown>;
    const body: Record<string, unknown> = {};
    for (const k of KEEP_ON_UPDATE) {
      const v = field(raw, k);
      if (v !== undefined) body[k] = v;
    }
    const iso = now.toISOString();
    const login = { ...(field<Record<string, unknown>>(raw, 'login') ?? {}) };
    body.login = { ...login, password: encrypt(newPassword, s.key), passwordRevisionDate: iso };
    const history = (field<unknown[]>(raw, 'passwordHistory') ?? []) as unknown[];
    body.passwordHistory = s.password
      ? [{ password: s.password, lastUsedDate: iso }, ...history].slice(0, PASSWORD_HISTORY_MAX)
      : history;
    body.lastKnownRevisionDate = field(raw, 'revisionDate') ?? null;
    body.encryptedFor = this.userId;
    return body;
  }

  lock(): void {
    for (const k of this.keys) wipe(k);
    this.secrets.clear();
    this.logins.length = 0;
  }
}
