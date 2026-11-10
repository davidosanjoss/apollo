// Sincronização entre computadores: login na nuvem escolhida, ciclo baixar → abrir →
// mesclar → aplicar → cifrar → enviar, e quando rodar.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import type { SecretBox } from '../secret-box';
import type { Store } from '../store';
import type { SyncInfo } from '../../shared/types';
import { authUrl, CloudClient, exchangeCode, pkce, PROVIDER_NAMES, type Credentials, type Fetch, type ProviderId } from './cloud';
import { envelopeSalt, open, seal, WrongPassphrase } from './crypto';
import { diff, emptyData, hasChanges, merge3, parseData, same, type SyncData } from './merge';
import { apply, matchWorkspaces, parseWorkspaceMap, snapshot, type ApplyHooks } from './local';

const TICK_MS = 60_000;
const PULL_EVERY_MS = 5 * 60_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

interface Secrets extends Credentials { passphrase: string }

export class SyncService {
  private secrets: Secrets | null = null;
  private status: SyncInfo['status'] = 'off';
  private error: string | null = null;
  private lastSync: number | null = null;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private login: { server: http.Server; timer: NodeJS.Timeout } | null = null;
  /** Testes: o endereço de login, em vez de abrir o navegador do sistema. */
  lastAuthUrl: string | null = null;

  constructor(private readonly o: {
    store: Store;
    box: SecretBox | null;
    fetch: Fetch;
    openExternal: (url: string) => void;
    hooks: ApplyHooks;
    onChange: () => void;
    tickMs?: number;
    /** De quanto em quanto tempo buscar o que mudou nos outros computadores. */
    pullMs?: number;
  }) {}

  info(): SyncInfo {
    return { status: this.status, provider: this.secrets?.provider ?? null, lastSync: this.lastSync, error: this.error,
      remembered: this.o.box !== null };
  }

  private set(status: SyncInfo['status'], error: string | null = null): void {
    this.status = status;
    this.error = error;
    this.o.onChange();
  }

  async start(): Promise<void> {
    const raw = this.o.store.getKv('sync-secret');
    if (!raw || !this.o.box) return;
    try {
      this.secrets = JSON.parse(await this.o.box.decrypt(Buffer.from(raw, 'base64'))) as Secrets;
      const last = Number(this.o.store.getKv('sync-last'));
      this.lastSync = Number.isFinite(last) && last > 0 ? last : null;
      this.set('ok');
      this.schedule();
      setTimeout(() => void this.syncNow(), 10_000).unref();
    } catch {
      this.set('error', 'Não foi possível ler a conexão salva (chaveiro do sistema). Conecte de novo.');
    }
  }

  private async saveSecrets(): Promise<void> {
    if (!this.secrets || !this.o.box) return; // sem chaveiro: só na memória (reconectar ao abrir)
    this.o.store.setKv('sync-secret', (await this.o.box.encrypt(JSON.stringify(this.secrets))).toString('base64'));
  }

  private schedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.secrets || this.running) return;
      const changed = !same(snapshot(this.o.store, parseWorkspaceMap(this.o.store.getKv('sync-ws-map'))), this.base());
      if (changed || !this.lastSync || Date.now() - this.lastSync > (this.o.pullMs ?? PULL_EVERY_MS)) void this.syncNow();
    }, this.o.tickMs ?? TICK_MS);
    this.timer.unref();
  }

  private base(): SyncData | null {
    const raw = this.o.store.getKv('sync-base');
    try { return raw ? parseData(JSON.parse(raw)) : null; } catch { return null; }
  }

  // ------------------------------------------------------------ conectar

  /** Login no navegador do sistema; volta para 127.0.0.1 com o código; depois sincroniza. */
  async connect(a: { provider: ProviderId; clientId: string; clientSecret: string | null; passphrase: string }): Promise<void> {
    this.cancelConnect();
    this.set('connecting');
    const { verifier, challenge } = pkce();
    const state = randomBytes(16).toString('hex');
    try {
      const { code, redirect } = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
        let redirect = '';
        const server = http.createServer((req, res) => {
          const u = new URL(req.url ?? '/', 'http://127.0.0.1');
          if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
          const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><title>Apollo</title><body style="font:16px system-ui;padding:40px">${ok
            ? `Apollo conectado ao ${PROVIDER_NAMES[a.provider]}. Pode fechar esta aba e voltar ao Apollo.`
            : 'Não deu certo. Volte ao Apollo e tente de novo.'}</body>`);
          if (ok) resolve({ code: u.searchParams.get('code')!, redirect });
          else reject(new Error(u.searchParams.get('error_description') || u.searchParams.get('error') || 'login cancelado'));
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const port = (server.address() as AddressInfo).port;
          // Microsoft aceita "localhost" registrado para qualquer porta; Google, o 127.0.0.1.
          redirect = `http://${a.provider === 'onedrive' ? 'localhost' : '127.0.0.1'}:${port}/callback`;
          const url = authUrl(a.provider, a.clientId, redirect, state, challenge);
          this.lastAuthUrl = url;
          this.o.openExternal(url);
        });
        const timer = setTimeout(() => reject(new Error('o login não foi concluído a tempo')), LOGIN_TIMEOUT_MS);
        this.login = { server, timer };
      });
      const t = await exchangeCode(this.o.fetch, a.provider, { clientId: a.clientId, clientSecret: a.clientSecret, code, verifier, redirect });
      if (!t.refresh_token) throw new Error('a nuvem não devolveu acesso permanente (refresh token)');
      this.secrets = { provider: a.provider, clientId: a.clientId, clientSecret: a.clientSecret, refreshToken: t.refresh_token, passphrase: a.passphrase };
      // Conta nova: começa do zero (base e vínculo de workspaces da conta anterior não valem).
      this.o.store.deleteKv('sync-base');
      this.o.store.deleteKv('sync-ws-map');
      await this.saveSecrets();
      this.schedule();
      this.set('ok');
      await this.syncNow();
    } catch (err) {
      if (this.status === 'connecting') this.set(this.secrets ? 'ok' : 'off', (err as Error).message);
    } finally {
      this.cancelConnect();
    }
  }

  cancelConnect(): void {
    if (!this.login) return;
    clearTimeout(this.login.timer);
    this.login.server.close();
    this.login = null;
    if (this.status === 'connecting') this.set(this.secrets ? 'ok' : 'off');
  }

  /** Desconecta este computador (os dados na nuvem e aqui ficam). */
  disconnect(): void {
    this.cancelConnect();
    this.secrets = null;
    for (const k of ['sync-secret', 'sync-base', 'sync-ws-map', 'sync-last']) this.o.store.deleteKv(k);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.lastSync = null;
    this.set('off');
  }

  // ------------------------------------------------------------ sincronizar

  private again = false;

  /** Pedido no meio de um ciclo: roda mais uma vez depois (o que mudou nesse meio-tempo também vai). */
  syncNow(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      do { this.again = false; await this.cycle(); } while (this.again && this.secrets);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  private async cycle(): Promise<void> {
    const s = this.secrets;
    if (!s) return;
    this.set('syncing');
    try {
      const store = this.o.store;
      const cloud = new CloudClient(s, this.o.fetch, () => void this.saveSecrets());
      const bytes = await cloud.download();
      const remote = bytes ? parseData(await open(bytes, s.passphrase)) : null;
      const base = this.base();
      let map = parseWorkspaceMap(store.getKv('sync-ws-map'));
      if (remote && !base) {
        map = matchWorkspaces(store, remote, map);
        store.setKv('sync-ws-map', JSON.stringify(map));
      }
      const local = snapshot(store, map);
      const merged = !remote ? merge3(emptyData(), local, emptyData())
        : !base ? merge3(emptyData(), local, remote, 'remote') // primeira vez neste computador: a nuvem vence
        : merge3(base, local, remote);
      const changes = diff(local, merged);
      if (hasChanges(changes)) apply(store, map, merged, changes, this.o.hooks);
      if (!remote || !same(merged, remote)) await cloud.upload(await seal(merged, s.passphrase, bytes ? envelopeSalt(bytes) : undefined));
      store.setKv('sync-base', JSON.stringify(merged));
      this.lastSync = Date.now();
      store.setKv('sync-last', String(this.lastSync));
      this.set('ok');
    } catch (err) {
      this.set('error', err instanceof WrongPassphrase ? err.message : `Falhou: ${(err as Error).message}`);
    }
  }
}
