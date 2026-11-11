// Infra dos testes de integração: servidor HTTP local + Apollo real controlado via CDP.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const RESOURCES_URL = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json';
import type { UiCommand, UiState } from '../../src/shared/types';

const electronBin = createRequire(import.meta.url)('electron') as unknown as string;
const ROOT = path.resolve(import.meta.dirname, '../..');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => Promise<T> | T, what: string, timeout = 10_000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch (err) { last = err; }
    await sleep(100);
  }
  throw new Error(`timeout esperando: ${what}${last ? ` (${String(last)})` : ''}`);
}

// ------------------------------------------------------------ servidor de sites de teste

export interface TestSite {
  url: string;
  /** Mesmo servidor por outro nome (localhost ≠ 127.0.0.1: conta como OUTRO site). */
  thirdParty: string;
  /** Caminhos que chegaram ao servidor (para provar que algo foi bloqueado na rede). */
  hits: string[];
  /** Último cabeçalho Cookie recebido por caminho. */
  cookies: Map<string, string>;
  close: () => Promise<void>;
}

/** Sites falsos: /page?title=X, /headers (eco), /set-cookie?v=X, /cookie. */
export async function startSite(): Promise<TestSite> {
  const hits: string[] = [];
  const cookies = new Map<string, string>();
  let port = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    hits.push(u.pathname);
    cookies.set(u.pathname, req.headers.cookie ?? '');
    const html = (body: string, title = 'Teste') => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>${title}</title><body>${body}</body>`);
    };
    switch (u.pathname) {
      case '/page': return html('ok', u.searchParams.get('title') ?? 'Teste');
      case '/blocktest':
        // Página em 127.0.0.1 que carrega um "anúncio" e um "rastreador" de localhost (terceiros).
        return html(`<script src="http://localhost:${port}/ads/banner.js"></script>
          <img src="http://localhost:${port}/track/pixel.gif">`, u.searchParams.get('title') ?? 'Bloqueio');
      case '/signup':
        return html(`<form onsubmit="return false"><input id="email" type="email" name="email">
          <input id="nova" type="password" name="nova"><input id="conf" type="password" name="conf"></form>`, 'Cadastro');
      case '/step1':
        return html(`<form onsubmit="return false"><input id="email" type="email" name="loginfmt"><button id="avancar">Avançar</button></form>`, 'Etapa 1');
      case '/step2':
        return html(`<form onsubmit="return false"><input id="senha" type="password" name="passwd"><button id="entrar">Entrar</button></form>`, 'Etapa 2');
      case '/share':
        // Como o Teams/Meet: botão chama getDisplayMedia (precisa de clique do usuário).
        return html(`<button id="compartilhar" style="width:200px;height:60px">Compartilhar</button><script>
          window.resultado = 'nada';
          document.getElementById('compartilhar').onclick = async () => {
            try {
              const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
              window.resultado = 'ok:' + s.getTracks().map((t) => t.kind).sort().join('+');
              s.getTracks().forEach((t) => t.stop());
            } catch (e) { window.resultado = 'erro:' + e.name; }
          };</script>`, 'Reunião');
      case '/custom':
        // A página tem uma variável própria: a personalização (mundo isolado) não pode vê-la.
        return html(`<p id="alvo">texto</p><script>window.segredoDaPagina = 'só da página';</script>`, 'Custom');
      case '/links':
        return html(`<a id="novo" href="/page?title=Aberto+do+painel" target="_blank">abrir</a>
          <p id="ua"></p><script>document.getElementById('ua').textContent = navigator.userAgent;</script>`, 'Links');
      case '/login':
        return html(`<form><input id="busca" type="search" name="q">
          <input id="email" type="email" name="email"><input id="senha" type="password" name="senha"></form>`, 'Entrar');
      case '/cosmetic':
        return html(`<div class="anuncio">ANUNCIO</div><div id="conteudo">conteudo</div>
          <script>document.title = window.adsEnabled === false ? 'scriptlet-ok' : 'scriptlet-nao';
          try { window.prunado = JSON.stringify(JSON.parse('{"anuncioA":1,"anuncioB":2,"video":3}')); } catch (e) { window.prunado = 'erro: ' + e.message; }
          setTimeout(() => { const d = document.createElement('div'); d.className = 'ad-slot-generico'; d.textContent = 'TARDIO';
            document.body.appendChild(d); }, 300);</script>`, 'cosmetic');
      case '/set-cookie-3p':
        // Cookie que PODE ir em requisições de terceiros (SameSite=None; localhost conta como seguro).
        res.writeHead(200, {
          'content-type': 'image/gif',
          'set-cookie': `tp=${u.searchParams.get('v')}; SameSite=None; Secure; Path=/; Max-Age=86400`,
        });
        return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
      case '/notify':
        // Como o WhatsApp: consulta a permissão, pede no clique e mostra notificações.
        return html(`<button id="pedir" style="width:200px;height:50px">Ativar notificações</button>
          <button id="simular" style="width:200px;height:50px">clique real</button><script>
          window.log = [];
          document.getElementById('pedir').onclick = async () => { window.log.push('pedido:' + await Notification.requestPermission()); };
          // Simula o clique na notificação: o Chromium dá ativação ao clicar nela; aqui, um clique real na página.
          document.getElementById('simular').onclick = () => document.dispatchEvent(new CustomEvent('apollo-notification-click'));
          </script>`, u.searchParams.get('title') ?? 'Mensagens');
      case '/fs':
        // Como o player do YouTube: botão põe um elemento em tela cheia.
        return html(`<div id="player" style="background:#000;color:#fff;height:200px">vídeo</div>
          <button id="cheia" style="width:200px;height:50px">Tela cheia</button><script>
          document.getElementById('cheia').onclick = () => document.getElementById('player').requestFullscreen();</script>`, 'Player');
      case '/article': {
        // Página de notícia: menu, anúncio, artigo longo e um script que tenta redesenhar a página.
        const p = (i: number) => `<p>Parágrafo ${i}. O cálculo diferencial estuda taxas de variação e inclinações de curvas, e é a base de boa parte da física e da engenharia. O cálculo diferencial estuda taxas de variação e inclinações de curvas, e é a base de boa parte da física e da engenharia. O cálculo diferencial estuda taxas de variação e inclinações de curvas, e é a base de boa parte da física e da engenharia.</p>`;
        return html(`<nav id="menu"><a href="/">Início</a> <a href="/x">Esportes</a></nav>
          <div class="ad" id="anuncio">COMPRE AGORA</div>
          <article><h1>Limites e derivadas</h1><p class="byline">Por Ana Souza</p>
          ${Array.from({ length: 12 }, (_, i) => p(i + 1)).join('')}
          <p><img src="/nao-existe.png" onerror="document.body.dataset.invadiu='1'" alt="figura"></p></article>
          <footer>Rodapé do site</footer>
          <script>setInterval(() => { document.body && document.body.insertAdjacentText('beforeend', 'INVADIU'); }, 300);</script>`, 'Notícia');
      }
      case '/camera':
        // Como uma chamada do WhatsApp/Teams: pede câmera e microfone.
        return html(`<button id="ligar" style="width:200px;height:60px">Ligar</button><script>
          window.resultado = 'nada';
          document.getElementById('ligar').onclick = async () => {
            try {
              const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
              window.resultado = 'ok:' + s.getTracks().map((t) => t.kind).sort().join('+');
              s.getTracks().forEach((t) => t.stop());
            } catch (e) { window.resultado = 'erro:' + e.name; }
          };</script>`, 'Chamada');
      case '/terminal':
        // Como um terminal web (xterm.js): usa Ctrl+R (busca no histórico) e não deixa o navegador agir.
        return html(`<pre id="saida" style="min-height:200px">$ </pre><script>
          window.log = [];
          document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'r') { e.preventDefault(); window.log.push('busca-reversa'); }
          });</script>`, 'Terminal');
      case '/find':
        return html(`<p>Cálculo I, cálculo II e CÁLCULO III.</p><p>Álgebra linear.</p>`, 'Disciplinas');
      case '/ctx':
        // Menu de contexto: link, imagem, campo com palavra errada, texto.
        return html(`<p id="texto">Universidade Federal</p>
          <p><a id="link" href="/page?title=Destino">Ir ao destino</a></p>
          <p><img id="img" src="/pixel" width="60" height="60" style="background:#c33"></p>
          <p><input id="campo" spellcheck="true" value="xyzzyq" style="width:300px"></p>`, 'Contexto');
      case '/pixel':
        res.writeHead(200, { 'content-type': 'image/gif' });
        return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
      case '/embed':
        // Página em 127.0.0.1 que pede uma imagem a localhost (terceiro).
        return html(`<img src="http://localhost:${port}${u.searchParams.get('src') ?? '/pixel'}">`, u.searchParams.get('title') ?? 'embed');
      case '/ads/banner.js':
        res.writeHead(200, { 'content-type': 'text/javascript' });
        return res.end('window.anuncioCarregou = true;');
      case '/track/pixel.gif':
        res.writeHead(200, { 'content-type': 'image/gif' });
        return res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
      case '/file': {
        // Download: anexo pequeno com o nome pedido.
        const name = u.searchParams.get('name') ?? 'arquivo.txt';
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '2048',
          'content-disposition': `attachment; filename="${name}"` });
        return res.end(Buffer.alloc(2048, 65));
      }
      case '/slow-file': {
        // Download lento (1 MB em ~6 s): dá tempo de pausar/cancelar.
        const total = 1024 * 1024;
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(total),
          'content-disposition': 'attachment; filename="grande.bin"' });
        let sent = 0;
        const timer = setInterval(() => {
          if (res.destroyed) { clearInterval(timer); return; }
          const n = Math.min(16 * 1024, total - sent);
          sent += n;
          res.write(Buffer.alloc(n, 66));
          if (sent >= total) { clearInterval(timer); res.end(); }
        }, 100);
        req.on('close', () => clearInterval(timer));
        return;
      }
      case '/slow': {
        // Página lenta: responde depois de ?ms (simula rede/CI lentos).
        const ms = Number(u.searchParams.get('ms') ?? 1500);
        setTimeout(() => html('ok', u.searchParams.get('title') ?? 'Lenta'), ms);
        return;
      }
      case '/headers':
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(req.headers));
      case '/set-cookie':
        res.writeHead(200, {
          'content-type': 'text/html',
          // Persistente (Max-Age): tem que sobreviver ao reinício.
          'set-cookie': `login=${u.searchParams.get('v')}; Max-Age=86400; Path=/; SameSite=Lax`,
        });
        return res.end('<title>cookie</title>ok');
      case '/cookie': return html(req.headers.cookie ?? '', 'cookie');
      case '/form':
        // Formulário "não enviado": pede confirmação ao sair (precisa de um clique antes).
        return html(`<input id="campo"><script>
          addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });
        </script>`, 'Formulário');
      case '/video':
        // Vídeo tocando (gerado no próprio navegador, sem arquivo nem som).
        return html(`<canvas width="64" height="64"></canvas><video muted autoplay></video><script>
          const c = document.querySelector('canvas'); const ctx = c.getContext('2d');
          setInterval(() => { ctx.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); ctx.fillRect(0, 0, 64, 64); }, 50);
          document.querySelector('video').srcObject = c.captureStream(20);
        </script>`, 'Video');
      case '/set-session-cookie':
        res.writeHead(200, {
          'content-type': 'text/html',
          // Sem Max-Age/Expires: cookie de SESSÃO (como os de login da Microsoft).
          'set-cookie': `sessao=${u.searchParams.get('v')}; Path=/; HttpOnly; SameSite=Lax`,
        });
        return res.end('<title>sessao</title>ok');
      default: res.writeHead(404); res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as net.AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    thirdParty: `http://localhost:${port}`,
    hits,
    cookies,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

// ------------------------------------------------------------ CDP

export class Cdp {
  private id = 0;
  private pending = new Map<number, (msg: { result?: unknown; error?: unknown }) => void>();
  private constructor(private ws: WebSocket) {
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      this.pending.get(msg.id)?.(msg);
      this.pending.delete(msg.id);
    };
    // Conexão caiu (app fechou/travou): falha as chamadas pendentes em vez de esperar para sempre.
    ws.onclose = () => {
      for (const resolve of this.pending.values()) resolve({ error: 'conexão de depuração fechada' });
      this.pending.clear();
    };
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    return new Cdp(ws);
  }

  call<T = unknown>(method: string, params: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const i = ++this.id;
      this.pending.set(i, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result as T)));
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }

  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.call<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Clique real do mouse (mousedown + mouseup), não element.click(). */
  async mouseClick(selector: string, button: 'left' | 'right' = 'left'): Promise<void> {
    const p = await this.eval<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' }); // como o usuário: rola até ver
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!p) throw new Error(`elemento não encontrado: ${selector}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.call('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, clickCount: 1 });
    }
  }

  /** Arrastar com o mouse de verdade: pressiona no elemento, move dx/dy em passos e solta. */
  async drag(selector: string, dx: number, dy = 0): Promise<void> {
    const p = await this.eval<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!p) throw new Error(`elemento não encontrado: ${selector}`);
    await this.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await this.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await this.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + (dx * i) / steps, y: p.y + (dy * i) / steps, button: 'left', buttons: 1 });
    }
    await this.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x + dx, y: p.y + dy, button: 'left', buttons: 0, clickCount: 1 });
  }

  /** Duplo clique de verdade. */
  async doubleClick(selector: string): Promise<void> {
    const p = await this.eval<{ x: number; y: number }>(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const clickCount of [1, 2]) {
      await this.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount });
      await this.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount });
    }
  }

  /** Enter de verdade (evento confiável) no elemento, como o usuário faria. */
  async pressEnter(selector: string): Promise<void> {
    await this.eval(`document.querySelector(${JSON.stringify(selector)}).focus(); true`);
    await this.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await this.call('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', text: '\r' });
    await this.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }

  /** Tecla de verdade na página (ex.: Ctrl+R): letra + modificadores (2 = Ctrl, 8 = Shift). */
  async pressKey(letter: string, modifiers = 2): Promise<void> {
    const key = letter.length === 1 ? letter.toLowerCase() : letter;
    const base = { key, code: letter.length === 1 ? `Key${letter.toUpperCase()}` : letter,
      windowsVirtualKeyCode: letter.length === 1 ? letter.toUpperCase().charCodeAt(0) : 0, modifiers };
    await this.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await this.call('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  close(): void { this.ws.close(); }
}

// ------------------------------------------------------------ Apollo

interface Target { type: string; url: string; webSocketDebuggerUrl: string }

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as net.AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

/** Servidor Bitwarden falso (http em 127.0.0.1) servindo um cofre sintético. */
export async function startFakeBitwarden(clientSecret: string, tokenBody: object, syncBody: object) {
  const calls: string[] = [];
  // Itens gravados pelo Apollo entram no /sync seguinte (como num servidor de verdade).
  const sync = JSON.parse(JSON.stringify(syncBody)) as { ciphers: Record<string, unknown>[] };
  const writes: { method: string; id?: string; body: Record<string, any> }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://x');
      calls.push(u.pathname);
      const json = (status: number, obj: object) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (u.pathname === '/identity/connect/token') {
        const form = new URLSearchParams(body);
        if (form.get('client_secret') !== clientSecret) return json(400, { error: 'invalid_client', error_description: '', message: 'Invalid client_id' });
        return json(200, tokenBody);
      }
      if (u.pathname === '/api/sync') {
        if (req.headers.authorization !== 'Bearer token-de-teste') return json(401, {});
        return json(200, sync);
      }
      if (u.pathname === '/api/ciphers' && req.method === 'POST') {
        const b = JSON.parse(body);
        const id = `novo-${writes.length}`;
        writes.push({ method: 'POST', id, body: b });
        sync.ciphers.push({ ...b, id, revisionDate: new Date().toISOString() });
        return json(200, { id });
      }
      const m = u.pathname.match(/^\/api\/ciphers\/(.+)$/);
      if (m && req.method === 'PUT') {
        const b = JSON.parse(body);
        writes.push({ method: 'PUT', id: m[1], body: b });
        const i = sync.ciphers.findIndex((c) => c.id === m[1]);
        sync.ciphers[i] = { ...sync.ciphers[i], ...b, id: m[1], revisionDate: new Date().toISOString() };
        return json(200, {});
      }
      json(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    writes,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** Listas de bloqueio de teste (no lugar das reais): /ads/ = anúncio, /track/ = rastreador. */
export function testFilters(dir: string): Record<string, string> {
  const ads = path.join(dir, 'test-ads.txt');
  const tracking = path.join(dir, 'test-tracking.txt');
  fs.writeFileSync(ads, [
    '/ads/banner.js$third-party',
    '127.0.0.1##.anuncio',                       // cosmético do site
    '##.ad-slot-generico',                       // cosmético genérico (via DOM)
    '127.0.0.1##+js(set-constant, adsEnabled, false)', // scriptlet
    '127.0.0.1##+js(json-prune, anuncioA)',            // dois json-prune juntos (como no YouTube)
    '127.0.0.1##+js(json-prune, anuncioB)',
  ].join('\n') + '\n');
  fs.writeFileSync(tracking, '/track/pixel.gif$third-party\n');
  // Recursos do uBlock (scriptlets) baixados pelo build (scripts/build-filters.mjs).
  const resources = path.join(ROOT, '.cache/filters',
    createHash('sha256').update(RESOURCES_URL).digest('hex').slice(0, 16) + '.txt');
  if (!fs.existsSync(resources)) throw new Error('rode `npm run build` antes (recursos do uBlock em .cache/filters)');
  return { APOLLO_TEST_FILTERS_ADS: ads, APOLLO_TEST_FILTERS_TRACKING: tracking, APOLLO_TEST_FILTERS_RESOURCES: resources };
}

export function tempProfile(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-e2e-'));
  return {
    dir,
    cleanup: () => {
      // Processos auxiliares do Chromium podem gravar por alguns ms depois de o app sair.
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch (err) {
        console.warn(`[e2e] não consegui apagar ${dir}: ${(err as Error).message}`);
      }
    },
  };
}

// Rede de segurança: se o processo de testes sair, nenhum Electron fica para trás.
const running = new Set<ChildProcess>();
process.once('exit', () => { for (const p of running) p.kill('SIGKILL'); });

/** Chama o Apollo de novo (como um link clicado em outro programa): a cópia nova entrega o link e sai. */
export function launchSecond(userData: string, args: string[]): Promise<number | null> {
  const headless = process.platform === 'linux' && !process.env.APOLLO_E2E_SHOW ? ['--ozone-platform=headless'] : [];
  const p = spawn(electronBin, [ROOT, ...headless, ...args], { env: { ...process.env, APOLLO_USER_DATA: userData }, stdio: 'ignore' });
  return new Promise((resolve) => p.once('exit', resolve));
}

export class Apollo {
  ui!: Cdp;
  private mainCdp: Cdp | null = null;
  private inspectPort: number | null = null;
  private constructor(private proc: ChildProcess, private port: number, readonly userData: string) {}

  /**
   * Processo principal (inspetor do Node). Só com env APOLLO_TEST_HOOKS=1 no launch:
   * `globalThis.__apolloTest.browser` é o Browser (ex.: o último menu de contexto).
   */
  async main(): Promise<Cdp> {
    if (!this.inspectPort) throw new Error('lance com { APOLLO_TEST_HOOKS: "1" }');
    if (this.mainCdp) return this.mainCdp;
    const t = await waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${this.inspectPort}/json/list`)).json() as Target[];
      return list[0];
    }, 'inspetor do processo principal');
    this.mainCdp = await Cdp.connect(t.webSocketDebuggerUrl);
    return this.mainCdp;
  }

  /** Abre o Apollo (build/) num perfil. Rode `npm run build` antes. */
  static async launch(userData: string, env: Record<string, string> = {}, args: string[] = []): Promise<Apollo> {
    const port = await freePort();
    // Sem janelas na tela (Linux): o Chromium desenha em memória. APOLLO_E2E_SHOW=1 mostra as janelas.
    // Tela virtual do tamanho de um monitor comum (o padrão do modo headless é pequeno demais).
    const headless = process.platform === 'linux' && !process.env.APOLLO_E2E_SHOW
      ? ['--ozone-platform=headless', '--ozone-override-screen-size=1600,1000'] : [];
    const inspectPort = env.APOLLO_TEST_HOOKS ? await freePort() : null;
    const inspect = inspectPort ? [`--inspect=127.0.0.1:${inspectPort}`] : [];
    const proc = spawn(electronBin, [...inspect, ROOT, `--remote-debugging-port=${port}`, ...headless, ...args], {
      env: { ...process.env, APOLLO_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '0', ...env },
      stdio: ['ignore', 'ignore', process.env.APOLLO_E2E_LOG ? 'inherit' : 'ignore'],
    });
    const app = new Apollo(proc, port, userData);
    app.inspectPort = inspectPort;
    running.add(proc);
    proc.once('exit', () => running.delete(proc));
    try {
      const ui = await waitFor(async () => (await app.targets()).find((t) => t.url.startsWith('apollo://ui')), 'janela do Apollo', 20_000);
      app.ui = await Cdp.connect(ui.webSocketDebuggerUrl);
      // A janela aparece antes de o preload expor window.apollo: espera.
      await waitFor(() => app.ui.eval<boolean>(`typeof window.apollo?.onState === 'function'`), 'API da UI');
      await app.ui.eval(`window.__s = null; window.apollo.onState((s) => { window.__s = s; }); true`);
      await waitFor(() => app.state(), 'primeiro estado da UI');
    } catch (err) {
      // Nunca deixa um Electron órfão rodando (travaria a bateria inteira).
      proc.kill('SIGKILL');
      throw err;
    }
    return app;
  }

  async targets(): Promise<Target[]> {
    return (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json() as Promise<Target[]>;
  }

  /** Página de uma aba (por prefixo de URL). */
  async page(urlPrefix: string): Promise<Cdp> {
    const t = await waitFor(async () => (await this.targets()).find((x) => x.type === 'page' && x.url.startsWith(urlPrefix)),
      `página ${urlPrefix}`);
    return Cdp.connect(t.webSocketDebuggerUrl);
  }

  async send(cmd: UiCommand | Record<string, unknown>): Promise<void> {
    await this.ui.eval(`window.apollo.send(${JSON.stringify(cmd)}); true`);
  }

  /** Estado mais recente empurrado para a UI (força um push com tab:focus). */
  async state(): Promise<UiState> {
    await this.send({ type: 'tab:focus' });
    await sleep(50);
    return this.ui.eval<UiState>('window.__s');
  }

  /** Espera o estado satisfazer `pred` (síncrono: para esperar a UI/página use waitFor). */
  async until(pred: (s: UiState) => boolean | undefined | null | '' | 0, what: string, timeout?: number): Promise<UiState> {
    let last: UiState | null = null;
    try {
      return await waitFor(async () => {
        const s = await this.state();
        last = s;
        const ok = pred(s) as unknown;
        if (ok instanceof Promise) throw new Error('until() recebeu predicado assíncrono; use waitFor');
        return ok ? s : null;
      }, what, timeout);
    } catch (err) {
      // Diagnóstico: onde a aba ativa estava quando o tempo acabou.
      const s = last as UiState | null;
      const t = s?.tabs.find((x) => x.id === s.activeTabId);
      throw new Error(`${(err as Error).message} | aba ativa: ${t ? JSON.stringify({ url: t.url, title: t.title, loading: t.loading, canGoBack: t.canGoBack, dormant: t.dormant }) : '—'}`);
    }
  }

  activeTab(s: UiState) { return s.tabs.find((t) => t.id === s.activeTabId)!; }

  /** Fecha como o usuário fecharia (grava cookies e banco). */
  async quit(): Promise<void> {
    this.mainCdp?.close();
    this.mainCdp = null;
    if (this.proc.exitCode !== null) return;
    const exited = new Promise((r) => this.proc.once('exit', r));
    // Se não fechar sozinho em 10 s, mata (e o teste que depende disso falha depois).
    const timer = setTimeout(() => this.proc.kill('SIGKILL'), 10_000);
    try {
      const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${this.port}/json/version`,
        { signal: AbortSignal.timeout(2000) })).json() as Target;
      const browser = await Cdp.connect(webSocketDebuggerUrl);
      // O app fecha antes de responder: não esperar a resposta.
      browser.call('Browser.close').catch(() => {});
    } catch {
      this.proc.kill('SIGTERM');
    }
    await exited;
    clearTimeout(timer);
    this.ui?.close();
  }
}
