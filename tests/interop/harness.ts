// Teste de compatibilidade REAL: servidor Vaultwarden (Docker) + CLI oficial do Bitwarden.
// Prova que a criptografia do Apollo conversa com a dos clientes oficiais, nos dois
// sentidos (conta criada pelo Apollo aberta pelo CLI; itens do CLI abertos pelo Apollo).
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { field } from '../../src/main/vault/api';
import { encrypt, hashMasterPassword, makeAccountKeys, makeMasterKey, rsaEncrypt, symKeyFrom, type Kdf } from '../../src/main/vault/crypto';

export const VAULTWARDEN_IMAGE = 'vaultwarden/server:1.37.5';
import { BITWARDEN_CLIENT_VERSION } from '../../src/main/vault/api';
// Mesma versão que o Apollo anuncia ao servidor: o teste prova exatamente essa combinação.
export const BW_CLI_VERSION = BITWARDEN_CLIENT_VERSION;
const ROOT = path.resolve(import.meta.dirname, '../..');
const BW_DIR = path.join(ROOT, '.cache/bw-cli');

export interface Server { url: string; caFile: string; stop: () => void }

/** Sobe um Vaultwarden descartável com HTTPS (o CLI oficial recusa http). */
export async function startVaultwarden(): Promise<Server> {
  // Certificado gerado pelo global-setup (o processo de teste já confia nele).
  const dir = process.env.APOLLO_INTEROP_CERT_DIR;
  if (!dir) throw new Error('rode com vitest.interop.config.ts (global-setup)');
  const id = execFileSync('docker', ['run', '-d', '--rm', '-p', '127.0.0.1::80', '-v', `${dir}:/ssl:ro`,
    '-e', 'I_REALLY_WANT_VOLATILE_STORAGE=true', '-e', 'ROCKET_TLS={certs="/ssl/cert.pem",key="/ssl/key.pem"}',
    '-e', 'SIGNUPS_ALLOWED=true', '-e', 'DISABLE_ICON_DOWNLOAD=true', '-e', `LOG_LEVEL=${process.env.APOLLO_VW_LOG ?? 'warn'}`,
    // Os testes fazem muitos logins seguidos: sem isso o Vaultwarden limita (HTTP 429).
    '-e', 'LOGIN_RATELIMIT_MAX_BURST=1000', '-e', 'LOGIN_RATELIMIT_SECONDS=1', VAULTWARDEN_IMAGE], { encoding: 'utf8' }).trim();
  const port = execFileSync('docker', ['port', id, '80/tcp'], { encoding: 'utf8' }).split('\n')[0].split(':').pop()!.trim();
  const url = `https://127.0.0.1:${port}`;
  const stop = () => { spawnSync('docker', ['rm', '-f', id], { stdio: 'ignore' }); };
  for (let i = 0; i < 60; i++) {
    if (spawnSync('curl', ['-skf', `${url}/alive`]).status === 0) return { url, caFile: `${dir}/cert.pem`, stop };
    await new Promise((r) => setTimeout(r, 500));
  }
  stop();
  throw new Error('Vaultwarden não subiu');
}

/** Cria a conta COM A CRIPTOGRAFIA DO APOLLO (fluxo de registro atual do Bitwarden). */
export async function registerAccount(server: Server, email: string, password: string, kdf: Kdf) {
  const r1 = await fetch(`${server.url}/identity/accounts/register/send-verification-email`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: 'Teste', receiveMarketingEmails: false }),
  });
  const raw = await r1.text();
  const token = raw.startsWith('"') ? JSON.parse(raw) : raw;
  const masterKey = await makeMasterKey(password, email, kdf);
  const keys = makeAccountKeys(masterKey);
  const r2 = await fetch(`${server.url}/identity/accounts/register/finish`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email, emailVerificationToken: token, masterPasswordHash: hashMasterPassword(masterKey, password), masterPasswordHint: null,
      userSymmetricKey: keys.protectedUserKey, userAsymmetricKeys: { publicKey: keys.publicKey, encryptedPrivateKey: keys.encryptedPrivateKey },
      kdf: kdf.type, kdfIterations: kdf.iterations,
      ...(kdf.type === 1 ? { kdfMemory: kdf.memory, kdfParallelism: kdf.parallelism } : {}),
    }),
  });
  if (!r2.ok) throw new Error(`registro falhou: HTTP ${r2.status} ${await r2.text()}`);
  return { masterKey, keys };
}

/** Cria uma organização com a criptografia do Apollo (chave da org cifrada com RSA do usuário). */
export async function createOrganization(server: Server, accessToken: string, userPublicKeyB64: string) {
  const orgRaw = crypto.randomBytes(64);
  const orgKey = symKeyFrom(orgRaw);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'der' } });
  const res = await fetch(`${server.url}/api/organizations`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      name: 'Faculdade', billingEmail: 'org@apollo.local', planType: 0,
      key: rsaEncrypt(orgRaw, Buffer.from(userPublicKeyB64, 'base64')),
      keys: { publicKey: publicKey.toString('base64'), encryptedPrivateKey: encrypt(privateKey, orgKey) },
      collectionName: encrypt('Padrão', orgKey),
    }),
  });
  if (!res.ok) throw new Error(`criar organização falhou: HTTP ${res.status} ${await res.text()}`);
  return field<string>(await res.json(), 'id')!;
}

/** Chave de API pessoal (como na tela de segurança do cofre web). */
export async function getApiKey(server: Server, accessToken: string, masterPasswordHash: string): Promise<string> {
  const res = await fetch(`${server.url}/api/accounts/api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ masterPasswordHash }),
  });
  if (!res.ok) throw new Error(`api-key falhou: HTTP ${res.status}`);
  return field<string>(await res.json(), 'apiKey')!;
}

// ------------------------------------------------------------ CLI oficial

export function ensureBwCli(): string {
  const bin = path.join(BW_DIR, 'node_modules/.bin/bw');
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(BW_DIR, { recursive: true });
    if (!fs.existsSync(path.join(BW_DIR, 'package.json'))) fs.writeFileSync(path.join(BW_DIR, 'package.json'), '{"private":true}');
    execFileSync('npm', ['i', '--silent', `@bitwarden/cli@${BW_CLI_VERSION}`], { cwd: BW_DIR, stdio: 'ignore' });
  }
  return bin;
}

export class BwCli {
  private readonly env: NodeJS.ProcessEnv;
  private session = '';
  constructor(private readonly bin: string, server: Server) {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-bwcli-'));
    this.env = { ...process.env, BITWARDENCLI_APPDATA_DIR: data, NODE_NO_WARNINGS: '1', BW_NOINTERACTION: 'true', NODE_EXTRA_CA_CERTS: server.caFile };
    this.run(['config', 'server', server.url]);
  }

  run(args: string[], input?: string): string {
    const r = spawnSync(this.bin, [...args, ...(this.session ? ['--session', this.session] : [])], { env: this.env, input, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`bw ${args[0]} falhou: ${(r.stdout + r.stderr).split('\n').filter((l) => !/^\s+at /.test(l)).join(' ').slice(0, 300)}`);
    return r.stdout.trim();
  }

  login(email: string, password: string): void {
    this.session = this.run(['login', email, password, '--raw']).split('\n').pop()!;
  }

  status(): string {
    return JSON.parse(this.run(['status'])).status;
  }

  createItem(item: object): void {
    this.run(['sync']);
    this.run(['create', 'item'], Buffer.from(JSON.stringify(item)).toString('base64'));
  }

  /** Item decifrado pelo CLI oficial. */
  getItem(id: string): Record<string, any> {
    this.run(['sync']);
    return JSON.parse(this.run(['get', 'item', id]));
  }

  listItems(): Record<string, any>[] {
    this.run(['sync']);
    return JSON.parse(this.run(['list', 'items']));
  }

  collections(orgId: string): { id: string }[] {
    this.run(['sync']);
    return JSON.parse(this.run(['list', 'org-collections', '--organizationid', orgId]));
  }
}
