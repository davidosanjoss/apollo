// Sincronização entre dois "computadores" (dois perfis do Apollo ao mesmo tempo), contra um
// Google Drive falso: login (OAuth com PKCE), arquivo cifrado, mesclagem, senha errada.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, tempProfile, waitFor, type Cdp } from './harness';

let server: http.Server;
let base = '';
let file: Buffer | null = null;
const challenges = new Map<string, string>(); // code → code_challenge
const apps: { app: Apollo; main: Cdp; profile: ReturnType<typeof tempProfile> }[] = [];

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const body = await new Promise<Buffer>((r) => { const parts: Buffer[] = []; req.on('data', (c) => parts.push(c)); req.on('end', () => r(Buffer.concat(parts))); });
    const json = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (u.pathname === '/google/authorize') {
      const code = `code-${Math.random()}`;
      challenges.set(code, u.searchParams.get('code_challenge')!);
      const back = new URL(u.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', code);
      back.searchParams.set('state', u.searchParams.get('state')!);
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (u.pathname === '/google/token') {
      const p = new URLSearchParams(body.toString());
      if (p.get('grant_type') === 'authorization_code') {
        // PKCE de verdade: o verificador tem que bater com o desafio do login.
        const ok = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url') === challenges.get(p.get('code') ?? '');
        return ok ? json(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) : json(400, { error: 'invalid_grant' });
      }
      return p.get('refresh_token') === 'RT' ? json(200, { access_token: 'AT', expires_in: 3600 }) : json(400, { error: 'invalid_grant' });
    }
    if (req.headers.authorization !== 'Bearer AT') return json(401, { error: 'unauthorized' });
    if (u.pathname === '/google/drive/v3/files' && req.method === 'GET') return json(200, { files: file ? [{ id: 'F' }] : [] });
    if (u.pathname === '/google/drive/v3/files/F') { res.writeHead(200).end(file); return; }
    if (u.pathname === '/google/upload/drive/v3/files' && req.method === 'POST') {
      // multipart/related: metadados + conteúdo; o conteúdo é a última parte.
      const text = body.toString('latin1');
      const start = text.lastIndexOf('\r\n\r\n') + 4;
      const end = text.lastIndexOf('\r\n--');
      file = Buffer.from(text.slice(start, end), 'latin1');
      return json(200, { id: 'F' });
    }
    if (u.pathname === '/google/upload/drive/v3/files/F' && req.method === 'PATCH') { file = body; return json(200, { id: 'F' }); }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const a of apps) { await a.app.quit(); a.profile.cleanup(); }
  server?.close();
});

async function computer() {
  const profile = tempProfile();
  const app = await Apollo.launch(profile.dir, { APOLLO_TEST_HOOKS: '1', APOLLO_TEST_SYNC_SERVER: base, APOLLO_TEST_SYNC_TICK_MS: '1500', APOLLO_TEST_SYNC_PULL_MS: '3000' });
  const c = { app, main: await app.main(), profile };
  apps.push(c);
  return c;
}

/** Conecta e "faz o login" (abre o endereço que o Apollo mandaria para o navegador do sistema). */
async function connect(c: { app: Apollo; main: Cdp }, passphrase: string) {
  await c.main.eval(`globalThis.__apolloTest.browser.syncService.lastAuthUrl = null; true`);
  await c.app.send({ type: 'sync:connect', provider: 'google', clientId: 'cliente-teste', clientSecret: 'segredo-teste', passphrase });
  const url = await waitFor(() => c.main.eval<string | null>(`globalThis.__apolloTest.browser.syncService.lastAuthUrl`), 'endereço de login');
  expect(new URL(url).searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata');
  const page = await fetch(url); // segue o redirecionamento até o 127.0.0.1 do Apollo
  expect(await page.text()).toContain('Apollo conectado ao Google Drive');
}

const titles = async (app: Apollo) => (await app.state()).bookmarks.map((b) => b.title).sort();

describe('sincronização entre computadores', () => {
  let A: Awaited<ReturnType<typeof computer>>;
  let B: Awaited<ReturnType<typeof computer>>;

  it('computador A: dados locais sobem cifrados para a nuvem', async () => {
    A = await computer();
    const principal = (await A.app.state()).activeWorkspaceId;
    await A.app.send({ type: 'workspace:create', name: 'Banco', color: '#22aa66', home: '' });
    await A.app.until((x) => x.workspaces.length === 2, 'workspace');
    await A.app.send({ type: 'workspace:switch', workspaceId: principal }); // favoritos no Principal
    await A.app.send({ type: 'bookmark:add-folder', title: 'Faculdade', parentId: null });
    const fac = (await A.app.until((s) => s.bookmarks.length === 1, 'pasta')).bookmarks[0].id;
    await A.app.send({ type: 'bookmark:add-folder', title: 'Moodle Cálculo', parentId: fac });
    await A.app.send({ type: 'settings:spellcheck', mode: 'pt' });
    await A.app.until((s) => s.workspaces.length === 2 && s.bookmarks.length === 2 && s.settings.spellcheck === 'pt', 'dados');
    await connect(A, 'senha de teste 123');
    await A.app.until((s) => s.settings.sync.status === 'ok' && s.settings.sync.lastSync !== null, 'sincronizado');
    expect(file).not.toBeNull();
    expect(file!.toString()).not.toContain('Moodle'); // cifrado
  });

  it('computador B: recebe tudo; o "Principal" de cada um vira o mesmo', async () => {
    B = await computer();
    await connect(B, 'senha de teste 123');
    const s = await B.app.until((x) => x.settings.sync.lastSync !== null && x.workspaces.length === 2, 'recebeu');
    expect(s.workspaces.map((w) => w.name).sort()).toEqual(['Banco', 'Principal']);
    expect(s.settings.spellcheck).toBe('pt');
    const principal = s.workspaces.find((w) => w.name === 'Principal')!.id;
    await B.app.send({ type: 'workspace:switch', workspaceId: principal });
    await B.app.until((x) => x.bookmarks.length === 2, 'favoritos no Principal');
    expect(await titles(B.app)).toEqual(['Faculdade', 'Moodle Cálculo']);
  });

  it('mudança em B chega em A; apagar em A apaga em B', async () => {
    await B.app.send({ type: 'bookmark:add-folder', title: 'Do B', parentId: null });
    await B.app.until((s) => s.bookmarks.length === 3, 'criou');
    await B.app.send({ type: 'sync:now' });
    await A.app.send({ type: 'sync:now' });
    await A.app.until((s) => s.bookmarks.some((b) => b.title === 'Do B'), 'chegou em A', 20_000);
    const doB = (await A.app.state()).bookmarks.find((b) => b.title === 'Do B')!.id;
    await A.app.send({ type: 'bookmark:remove', bookmarkId: doB });
    await A.app.send({ type: 'sync:now' });
    await A.app.until((s) => !s.bookmarks.some((b) => b.title === 'Do B'), 'apagou em A');
    await new Promise((r) => setTimeout(r, 300));
    await B.app.send({ type: 'sync:now' });
    await B.app.until((s) => !s.bookmarks.some((b) => b.title === 'Do B'), 'apagou em B', 20_000);
  });

  it('mudanças locais sobem sozinhas (sem "Sincronizar agora")', async () => {
    await A.app.send({ type: 'bookmark:add-folder', title: 'Automático', parentId: null });
    await B.app.until((s) => s.bookmarks.some((b) => b.title === 'Automático'), 'chegou sozinho em B', 30_000);
  });

  it('outro computador com a senha errada: não abre e avisa', async () => {
    const C = await computer();
    await connect(C, 'outra senha qualquer');
    const s = await C.app.until((x) => x.settings.sync.status === 'error', 'erro');
    expect(s.settings.sync.error).toContain('senha');
    expect(s.workspaces).toHaveLength(1); // nada aplicado
    await C.app.send({ type: 'sync:disconnect' });
    await C.app.until((x) => x.settings.sync.status === 'off', 'desconectado');
  });
});
