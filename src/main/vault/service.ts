// Serviço do cofre: conectar, desbloquear, bloquear, sincronizar, bloqueio automático.
// Persistência: conta (sem segredos) em claro; client_secret e cópia do /sync
// cifrados com o chaveiro do sistema. Sem chaveiro, nada sensível vai para o disco.
import type { VaultStatusInfo } from '../../shared/types';
import { BitwardenError, type BitwardenApi, type ServerChoice } from './api';
import { makeMasterKey, VaultCryptoError, wipe, type Kdf } from './crypto';
import { UnlockedVault } from './vault';

export interface SecretBox {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export interface VaultStorage {
  getAccount(): string | null;
  setAccount(json: string | null): void;
  getSecret(name: 'clientSecret' | 'sync'): Buffer | null;
  setSecret(name: 'clientSecret' | 'sync', data: Buffer | null): void;
}

export interface Account {
  server: ServerChoice;
  clientId: string;
  email: string;
  kdf: Kdf;
  deviceId: string;
  lockAfterMin: number;
  lastSync: number | null;
}

export type ApiFactory = (server: ServerChoice, deviceId: string) => Pick<BitwardenApi, 'loginApiKey' | 'sync'>;

export const LOCK_OPTIONS_MIN = [1, 5, 15, 30, 60, 240] as const;
const DEFAULT_LOCK_MIN = 15;

export class VaultService {
  private account: Account | null = null;
  private vault: UnlockedVault | null = null;
  private masterKey: Buffer | null = null;
  private busy = false;
  private error: string | null = null;

  constructor(
    private readonly storage: VaultStorage,
    private readonly box: SecretBox | null,
    private readonly apiFor: ApiFactory,
    private readonly onChange: () => void,
    private readonly newDeviceId: () => string,
  ) {
    try {
      const raw = storage.getAccount();
      if (raw) this.account = JSON.parse(raw) as Account;
    } catch {
      storage.setAccount(null);
    }
  }

  get unlocked(): UnlockedVault | null {
    return this.vault;
  }

  info(): VaultStatusInfo {
    const a = this.account;
    return {
      status: this.vault ? 'unlocked' : a ? 'locked' : 'disconnected',
      email: a?.email ?? null,
      server: a ? (a.server === 'us' ? 'bitwarden.com' : a.server === 'eu' ? 'bitwarden.eu' : new URL(a.server).host) : null,
      count: this.vault?.logins.length ?? 0,
      lastSync: a?.lastSync ?? null,
      lockAfterMin: a?.lockAfterMin ?? DEFAULT_LOCK_MIN,
      busy: this.busy,
      error: this.error,
      canRemember: this.box !== null,
    };
  }

  private async run<T>(fn: () => Promise<T>): Promise<T | null> {
    this.busy = true;
    this.error = null;
    this.onChange();
    try {
      return await fn();
    } catch (err) {
      this.error = err instanceof BitwardenError || err instanceof VaultCryptoError ? err.message : `falha inesperada: ${(err as Error).message}`;
      return null;
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  /** Primeira conexão: chave de API + senha mestra (que só é usada aqui, localmente). */
  connect(server: ServerChoice, clientId: string, clientSecret: string, password: string): Promise<boolean | null> {
    return this.run(async () => {
      const deviceId = this.account?.deviceId ?? this.newDeviceId();
      const api = this.apiFor(server, deviceId);
      const token = await api.loginApiKey(clientId.trim(), clientSecret.trim());
      const sync = await api.sync(token.accessToken);
      const email = String((sync as { profile?: { email?: string } }).profile?.email ?? '');
      if (!email || !token.kdf) throw new BitwardenError('unexpected', 'o servidor não informou e-mail/KDF da conta');
      const masterKey = await makeMasterKey(password, email, token.kdf);
      const vault = UnlockedVault.open(sync, masterKey, token.key); // falha aqui = senha mestra errada (nada salvo)

      this.replaceVault(vault, masterKey);
      this.account = { server, clientId: clientId.trim(), email, kdf: token.kdf, deviceId, lockAfterMin: this.account?.lockAfterMin ?? DEFAULT_LOCK_MIN, lastSync: Date.now() };
      this.persist(clientSecret.trim(), sync);
      return true;
    });
  }

  /** Desbloqueio: abre a cópia local (funciona sem internet) e sincroniza em seguida. */
  unlock(password: string): Promise<boolean | null> {
    return this.run(async () => {
      const a = this.account;
      if (!a) throw new BitwardenError('unexpected', 'nenhuma conta conectada');
      const masterKey = await makeMasterKey(password, a.email, a.kdf);
      const cached = this.readCachedSync();
      if (cached) {
        this.replaceVault(UnlockedVault.open(cached, masterKey), masterKey);
        void this.sync();
      } else {
        const sync = await this.fetchSync();
        this.replaceVault(UnlockedVault.open(sync, masterKey), masterKey);
        this.saveSync(sync);
      }
      return true;
    });
  }

  /** Busca o cofre de novo (se desbloqueado). Sem internet: mantém o que tem. */
  sync(): Promise<boolean | null> {
    return this.run(async () => {
      if (!this.vault || !this.masterKey) return false;
      const sync = await this.fetchSync();
      this.replaceVault(UnlockedVault.open(sync, this.masterKey), this.masterKey);
      this.saveSync(sync);
      return true;
    });
  }

  lock(): void {
    if (!this.vault && !this.masterKey) return;
    this.vault?.lock();
    this.vault = null;
    wipe(this.masterKey);
    this.masterKey = null;
    this.onChange();
  }

  /** Esquece a conta neste computador (segredo, cópia local, tudo). */
  disconnect(): void {
    this.lock();
    this.account = null;
    this.storage.setAccount(null);
    this.storage.setSecret('clientSecret', null);
    this.storage.setSecret('sync', null);
    this.error = null;
    this.onChange();
  }

  setLockAfter(minutes: number): void {
    if (!this.account || !(LOCK_OPTIONS_MIN as readonly number[]).includes(minutes)) return;
    this.account = { ...this.account, lockAfterMin: minutes };
    this.storage.setAccount(JSON.stringify(this.account));
    this.onChange();
  }

  /** Chamado periodicamente com o tempo ocioso do sistema (segundos). */
  checkIdle(idleSeconds: number): void {
    if (this.vault && this.account && idleSeconds >= this.account.lockAfterMin * 60) this.lock();
  }

  // ------------------------------------------------------------ interno

  private replaceVault(vault: UnlockedVault, masterKey: Buffer): void {
    if (this.vault && this.vault !== vault) this.vault.lock();
    if (this.masterKey && this.masterKey !== masterKey) wipe(this.masterKey);
    this.vault = vault;
    this.masterKey = masterKey;
  }

  private async fetchSync(): Promise<unknown> {
    const a = this.account!;
    const secret = this.box && this.storage.getSecret('clientSecret');
    if (!secret || !this.box) throw new BitwardenError('unexpected', 'chave de API não salva neste computador: conecte de novo');
    const api = this.apiFor(a.server, a.deviceId);
    const token = await api.loginApiKey(a.clientId, this.box.decrypt(secret));
    const sync = await api.sync(token.accessToken);
    this.account = { ...a, lastSync: Date.now(), ...(token.kdf ? { kdf: token.kdf } : {}) };
    this.storage.setAccount(JSON.stringify(this.account));
    return sync;
  }

  private persist(clientSecret: string, sync: unknown): void {
    this.storage.setAccount(JSON.stringify(this.account));
    if (!this.box) return; // sem chaveiro: nada sensível no disco
    this.storage.setSecret('clientSecret', this.box.encrypt(clientSecret));
    this.saveSync(sync);
  }

  private saveSync(sync: unknown): void {
    if (this.box) this.storage.setSecret('sync', this.box.encrypt(JSON.stringify(sync)));
  }

  private readCachedSync(): unknown | null {
    const data = this.box && this.storage.getSecret('sync');
    if (!data || !this.box) return null;
    try {
      return JSON.parse(this.box.decrypt(data));
    } catch {
      return null;
    }
  }
}
