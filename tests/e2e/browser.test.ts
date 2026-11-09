import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, sleep, startSite, tempProfile, waitFor, type TestSite } from './harness';

let app: Apollo;
let site: TestSite;
let profile: ReturnType<typeof tempProfile>;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
});

afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const navigate = async (url: string) => {
  await app.send({ type: 'tab:navigate', url });
  return app.until((s) => app.activeTab(s).url.startsWith(url) && !app.activeTab(s).loading, `navegar para ${url}`);
};

describe('primeira execução', () => {
  it('começa com um workspace "Principal" na página inicial', async () => {
    const s = await app.state();
    expect(s.workspaces.map((w) => w.name)).toEqual(['Principal']);
    expect(s.tabs).toHaveLength(1);
    expect(app.activeTab(s).url).toMatch(/^apollo:\/\/home/);
  });
});

describe('abas', () => {
  it('navega e atualiza título e URL', async () => {
    const s = await navigate(`${site.url}/page?title=Ola`);
    await waitFor(async () => app.activeTab(await app.state()).title === 'Ola', 'título');
    expect(app.activeTab(s).url).toBe(`${site.url}/page?title=Ola`);
  });

  // Regressão: ir para uma aba vazia (que foca a barra de endereço) mantinha na
  // barra a URL da aba anterior.
  it('barra de endereço mostra a URL da aba atual ao trocar de aba', async () => {
    const address = () => app.ui.eval<string>(`document.getElementById('address').value`);
    const s0 = await navigate(`${site.url}/page?title=Origem`);
    const origem = s0.activeTabId!;
    await waitFor(async () => (await address()) === `${site.url}/page?title=Origem`, 'URL na barra');

    await app.send({ type: 'tab:new' });
    const s1 = await app.until((x) => x.activeTabId !== origem, 'aba nova');
    await waitFor(async () => app.ui.eval<boolean>(`document.activeElement.id === 'address'`), 'barra focada');
    await sleep(200);
    expect(await address()).toBe('');

    // Voltar para a aba com site (barra ainda focada) mostra a URL dela.
    await app.send({ type: 'tab:activate', tabId: origem });
    await waitFor(async () => (await address()) === `${site.url}/page?title=Origem`, 'URL da aba de origem');

    // E de novo para a vazia.
    await app.send({ type: 'tab:activate', tabId: s1.activeTabId! });
    await waitFor(async () => (await address()) === '', 'barra vazia na aba vazia');

    // O que o usuário está digitando não é apagado por atualizações da MESMA aba.
    await app.ui.eval(`(() => { const a = document.getElementById('address'); a.focus(); a.value = 'digitando'; a.dispatchEvent(new Event('input')); return true; })()`);
    await app.send({ type: 'tab:focus' });
    await sleep(200);
    expect(await address()).toBe('digitando');
    await app.send({ type: 'tab:close', tabId: s1.activeTabId! });
    await app.until((x) => x.activeTabId === origem, 'fechou a vazia');
  });

  it('nova aba e fechar aba', async () => {
    const before = (await app.state()).tabs.length;
    await app.send({ type: 'tab:new' });
    const s = await app.until((x) => x.tabs.length === before + 1, 'nova aba');
    await app.send({ type: 'tab:close', tabId: s.activeTabId! });
    await app.until((x) => x.tabs.length === before, 'aba fechada');
  });

  // Regressão: com a barra de endereço focada (sempre, numa aba nova), o primeiro
  // clique no × não fechava a aba — a lista era recriada no meio do clique.
  it('fecha a aba com UM clique no ×, mesmo com a barra de endereço focada', async () => {
    await app.send({ type: 'tab:new' });
    await app.send({ type: 'tab:new' });
    const s = await app.until((x) => x.tabs.length >= 3, 'abas extras');
    const count = s.tabs.length;
    await app.ui.eval(`document.getElementById('address').focus(); true`);
    await app.ui.mouseClick('#tabs .tab:last-child .close');
    await app.until((x) => x.tabs.length === count - 1, 'aba fechada com um clique', 3000);
    // E sem foco na barra também.
    await app.ui.mouseClick('#tabs .tab:last-child .close');
    await app.until((x) => x.tabs.length === count - 2, 'segunda aba fechada', 3000);
  });

  it('ao fechar a última aba, o workspace continua com uma aba', async () => {
    let s = await app.state();
    for (const t of s.tabs) await app.send({ type: 'tab:close', tabId: t.id });
    s = await app.until((x) => x.tabs.length === 1 && !s.tabs.some((t) => t.id === x.activeTabId), 'aba nova criada');
    expect(app.activeTab(s).url).toMatch(/^apollo:\/\/home/);
  });

  it('endereço inacessível mostra a página de erro e mantém a URL digitada', async () => {
    const dead = 'http://127.0.0.1:1/';
    await app.send({ type: 'tab:navigate', url: dead });
    const page = await app.page('apollo://error');
    page.close();
    const s = await app.until((x) => app.activeTab(x).url === dead, 'URL original na barra');
    expect(app.activeTab(s).url).toBe(dead);
  });
});

describe('segurança da página', () => {
  it('site não enxerga a API do navegador nem o Node', async () => {
    await navigate(`${site.url}/page?title=Isolado`);
    const page = await app.page(`${site.url}/page?title=Isolado`);
    expect(await page.eval('typeof window.apollo')).toBe('undefined');
    expect(await page.eval('typeof require + "/" + typeof process')).toBe('undefined/undefined');
    page.close();
  });

  it('comando malformado vindo da UI é ignorado', async () => {
    await app.send({ type: 'workspace:create', name: 'x'.repeat(500), color: 'red', home: '' });
    await app.send({ type: 'permission:set', origin: site.url, kind: 'toString', decision: 'allow' });
    const s = await app.state();
    expect(s.workspaces.some((w) => w.name.startsWith('xxx'))).toBe(false);
  });

  it('envia o cabeçalho Global Privacy Control', async () => {
    await navigate(`${site.url}/page?title=GPC`);
    const page = await app.page(`${site.url}/page?title=GPC`);
    const headers = await page.eval<Record<string, string>>(`fetch('/headers').then((r) => r.json())`);
    expect(headers['sec-gpc']).toBe('1');
    page.close();
  });
});

describe('permissões', () => {
  it('notificações começam negadas', async () => {
    await navigate(`${site.url}/page?title=Perm`);
    const page = await app.page(`${site.url}/page?title=Perm`);
    expect(await page.eval('Notification.permission')).toBe('denied');
    page.close();
  });

  it('localização pergunta, bloquear nega e a decisão é lembrada', async () => {
    const page = await app.page(`${site.url}/page?title=Perm`);
    const ask = () => page.eval<string>(`new Promise((r) => navigator.geolocation.getCurrentPosition(
      () => r('granted'), (e) => r('error:' + e.code), { timeout: 8000 }))`);

    const first = ask();
    const s = await app.until((x) => x.permissionPrompt?.kinds.includes('geolocation'), 'barra de permissão');
    expect(await app.ui.eval(`!document.getElementById('permission-bar').hidden`)).toBe(true);
    await app.send({ type: 'permission:answer', promptId: s.permissionPrompt!.id, decision: 'deny', remember: true });
    expect(await first).toBe('error:1');

    const after = await app.state();
    expect(after.sitePermissions?.entries.find((e) => e.kind === 'geolocation')?.decision).toBe('deny');
    expect(await ask()).toBe('error:1');
    expect((await app.state()).permissionPrompt).toBeNull();
    page.close();
  });
});

describe('workspaces', () => {
  let other: string;

  it('cria e troca para o novo workspace', async () => {
    await app.send({ type: 'workspace:create', name: 'Trabalho', color: '#123456', home: '' });
    const s = await app.until((x) => x.workspaces.some((w) => w.name === 'Trabalho'), 'workspace criado');
    other = s.workspaces.find((w) => w.name === 'Trabalho')!.id;
    expect(s.activeWorkspaceId).toBe(other);
  });

  it('logins (cookies) são isolados entre workspaces', async () => {
    const s0 = await app.state();
    const principal = s0.workspaces.find((w) => w.name === 'Principal')!.id;

    await app.send({ type: 'workspace:switch', workspaceId: principal });
    await app.until((x) => x.activeWorkspaceId === principal, 'trocar para Principal');
    await navigate(`${site.url}/set-cookie?v=pessoal`);
    await navigate(`${site.url}/cookie`);
    const p1 = await app.page(`${site.url}/cookie`);
    expect(await p1.eval('document.body.textContent')).toBe('login=pessoal');
    p1.close();

    await app.send({ type: 'workspace:switch', workspaceId: other });
    await app.until((x) => x.activeWorkspaceId === other, 'trocar para Trabalho');
    await navigate(`${site.url}/cookie`);
    const targets = (await app.targets()).filter((t) => t.url === `${site.url}/cookie`);
    expect(targets).toHaveLength(2);
    // Lê o corpo das duas abas: a do Trabalho não pode ter o cookie do Principal.
    const bodies = await Promise.all(targets.map(async (t) => {
      const { Cdp } = await import('./harness');
      const c = await Cdp.connect(t.webSocketDebuggerUrl);
      const body = await c.eval<string>('document.body.textContent');
      c.close();
      return body;
    }));
    expect(bodies.sort()).toEqual(['', 'login=pessoal']);
  });

  it('excluir workspace volta para outro e remove o excluído', async () => {
    await app.send({ type: 'workspace:delete', workspaceId: other });
    const s = await app.until((x) => !x.workspaces.some((w) => w.id === other), 'workspace excluído');
    expect(s.workspaces.some((w) => w.id === s.activeWorkspaceId)).toBe(true);
  });

  it('não exclui o último workspace', async () => {
    const s = await app.state();
    expect(s.workspaces).toHaveLength(1);
    await app.send({ type: 'workspace:delete', workspaceId: s.workspaces[0].id });
    const after = await app.state();
    expect(after.workspaces).toHaveLength(1);
  });
});
