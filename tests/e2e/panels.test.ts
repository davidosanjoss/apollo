// Fase 5b: painéis laterais.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, sleep, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let principal: string;
let trabalho: string;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
  principal = (await app.state()).activeWorkspaceId;
  // Login (cookie) só no Principal.
  await app.send({ type: 'tab:navigate', url: `${site.url}/set-cookie?v=principal` });
  await app.until((s) => app.activeTab(s).url.includes('set-cookie') && !app.activeTab(s).loading, 'cookie no Principal');
  await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=Pagina` });
  await app.until((s) => app.activeTab(s).title === 'Pagina', 'página');
  await app.send({ type: 'workspace:create', name: 'Trabalho', color: '#123456', home: '' });
  trabalho = (await app.until((s) => s.workspaces.length === 2, 'trabalho')).workspaces.find((w) => w.name === 'Trabalho')!.id;
  await app.send({ type: 'workspace:switch', workspaceId: principal });
  await app.until((s) => s.activeWorkspaceId === principal, 'de volta ao Principal');
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const pageTargets = async (url: string) => (await app.targets()).filter((t) => t.type === 'page' && t.url === url);
const tabWidth = async () => { const p = await app.page(`${site.url}/page?title=Pagina`); const w = await p.eval<number>('innerWidth'); p.close(); return w; };

describe('painéis laterais', () => {
  let first: string;

  it('adicionar pela interface: abre ao lado e a página encolhe', async () => {
    const before = await tabWidth();
    await app.ui.mouseClick('#panel-add');
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('panel-dialog').open`), 'diálogo');
    await app.ui.eval(`document.getElementById('panel-url').value = ${JSON.stringify(`${site.url}/cookie`)};
      document.getElementById('panel-form').requestSubmit(); true`);
    const s = await app.until((x) => x.panels.length === 1 && x.activePanelId !== null, 'painel aberto');
    first = s.panels[0].id;
    expect(s.panels[0]).toMatchObject({ workspaceId: principal, width: 420, mobile: false, loaded: true });
    await waitFor(async () => (await pageTargets(`${site.url}/cookie`)).length === 1, 'site do painel carregado');
    await waitFor(async () => (await tabWidth()) <= before - 400, 'página mais estreita');
  });

  it('usa os logins do workspace escolhido', async () => {
    const [t] = await pageTargets(`${site.url}/cookie`);
    const { Cdp } = await import('./harness');
    const p = await Cdp.connect(t.webSocketDebuggerUrl);
    await waitFor(async () => (await p.eval<string>('document.body?.textContent ?? ""')).includes('login=principal'), 'cookie do Principal no painel');
    p.close();
  });

  it('fechar mantém vivo (mensagens continuam chegando); a página volta ao tamanho', async () => {
    const before = await tabWidth();
    await app.send({ type: 'panel:toggle', panelId: first });
    const s = await app.until((x) => x.activePanelId === null, 'fechado');
    expect(s.panels[0].loaded).toBe(true);
    expect(await pageTargets(`${site.url}/cookie`)).toHaveLength(1);
    await waitFor(async () => (await tabWidth()) >= before + 400, 'página volta a largura');
  });

  it('painel de OUTRO workspace não vê o login do Principal; só um aberto por vez', async () => {
    await app.send({ type: 'panel:add', url: `${site.url}/cookie?trabalho`, workspaceId: trabalho, mobile: false });
    const s = await app.until((x) => x.panels.length === 2 && x.activePanelId === x.panels[1].id, 'segundo painel');
    expect(s.activePanelId).not.toBe(first);
    const t = await waitFor(async () => (await pageTargets(`${site.url}/cookie?trabalho`))[0], 'carregado');
    const { Cdp } = await import('./harness');
    const p = await Cdp.connect(t.webSocketDebuggerUrl);
    await waitFor(async () => (await p.eval<string>('document.readyState')) === 'complete', 'pronto');
    expect(await p.eval('document.body.textContent')).toBe('');
    p.close();
  });

  it('versão para celular troca o user agent; link "nova aba" abre como aba do workspace do painel', async () => {
    await app.send({ type: 'panel:add', url: `${site.url}/links`, workspaceId: trabalho, mobile: true });
    const t = await waitFor(async () => (await pageTargets(`${site.url}/links`))[0], 'painel de links');
    const { Cdp } = await import('./harness');
    const p = await Cdp.connect(t.webSocketDebuggerUrl);
    await waitFor(async () => /Mobile/.test(await p.eval<string>('navigator.userAgent')), 'UA de celular');
    await p.mouseClick('#novo');
    p.close();
    const s = await app.until((x) => x.activeWorkspaceId === trabalho && app.activeTab(x).url.endsWith('Aberto+do+painel'), 'aba no Trabalho');
    expect(app.activeTab(s).url).toBe(`${site.url}/page?title=Aberto+do+painel`);
  });

  it('arrastar a borda muda a largura do painel e salva só para ele', async () => {
    let s = await app.state();
    const [a, b] = s.panels;
    await app.send({ type: 'panel:toggle', panelId: a.id });
    await app.until((x) => x.activePanelId === a.id, 'painel A aberto');
    await waitFor(() => app.ui.eval<boolean>(`!document.getElementById('panel-resizer').hidden`), 'alça visível');
    await app.ui.drag('#panel-resizer', -150); // para a esquerda = mais largo
    s = await app.until((x) => x.panels.find((p) => p.id === a.id)!.width === 570, 'A salvo com 570');
    expect(s.panels.find((p) => p.id === b.id)!.width).toBe(420); // o outro não muda
    expect(await app.ui.eval<number>(`Math.round(document.getElementById('panel-area').getBoundingClientRect().width)`)).toBe(570);

    // Abrir o outro painel usa a largura DELE.
    await app.send({ type: 'panel:toggle', panelId: b.id });
    await app.until((x) => x.activePanelId === b.id, 'B aberto');
    await waitFor(async () => (await app.ui.eval<number>(`Math.round(document.getElementById('panel-area').getBoundingClientRect().width)`)) === 420, 'B com 420');
    await app.ui.drag('#panel-resizer', 100); // para a direita = mais estreito
    await app.until((x) => x.panels.find((p) => p.id === b.id)!.width === 320, 'B salvo com 320');
  });

  // Regressão: ajustar a largura apagava a "versão para celular" (patch com undefined).
  it('mudar a largura não desliga a versão para celular', async () => {
    const id = (await app.state()).activePanelId!;
    await app.send({ type: 'panel:set', panelId: id, mobile: true });
    await app.until((x) => x.panels.find((p) => p.id === id)!.mobile, 'celular ligado');
    await app.send({ type: 'panel:set', panelId: id, width: 360 });
    const s = await app.until((x) => x.panels.find((p) => p.id === id)!.width === 360, 'largura salva');
    expect(s.panels.find((p) => p.id === id)!.mobile).toBe(true);
    await app.send({ type: 'panel:set', panelId: id, mobile: false });
    await app.until((x) => !x.panels.find((p) => p.id === id)!.mobile, 'celular desligado');
  });

  it('não passa dos limites; duplo clique volta à largura padrão', async () => {
    const b = (await app.state()).activePanelId!;
    await app.ui.drag('#panel-resizer', 2000);
    await app.until((x) => x.panels.find((p) => p.id === b)!.width === 260, 'mínimo 260');
    await app.ui.doubleClick('#panel-resizer');
    await app.until((x) => x.panels.find((p) => p.id === b)!.width === 420, 'padrão 420');
    await app.send({ type: 'panel:set', panelId: b, width: 333 });
    await app.until((x) => x.panels.find((p) => p.id === b)!.width === 333, 'salvo');
  });

  it('remover fecha o site; ao reabrir o Apollo os painéis voltam, sem carregar sozinhos', async () => {
    const s0 = await app.state();
    const links = s0.panels.find((p) => p.url.endsWith('/links'))!;
    await app.send({ type: 'panel:remove', panelId: links.id });
    await app.until((x) => x.panels.length === 2, 'removido');
    await waitFor(async () => (await pageTargets(`${site.url}/links`)).length === 0, 'site fechado');

    await app.quit();
    app = await Apollo.launch(profile.dir);
    const s = await app.state();
    expect(s.panels.map((p) => p.loaded)).toEqual([false, false]);
    expect(s.panels.map((p) => p.width)).toEqual([570, 333]); // larguras escolhidas sobrevivem
    expect(s.activePanelId).toBeNull();
    await sleep(300);
    expect(await pageTargets(`${site.url}/cookie`)).toHaveLength(0); // não carregou sem pedir
  });
});
