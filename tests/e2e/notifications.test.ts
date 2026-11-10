// Notificações: o site enxerga "perguntar" (não "negado"), pede pela barra do Apollo;
// clicar na notificação leva à aba (só com ativação real do usuário).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let page: Cdp;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
  await app.send({ type: 'tab:navigate', url: `${site.url}/notify` });
  await app.until((s) => app.activeTab(s).title === 'Mensagens' && !app.activeTab(s).loading, 'página');
  page = await app.page(`${site.url}/notify`);
});
afterAll(async () => {
  page?.close();
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const seen = (p: Cdp) => p.eval<[string, string]>(`(async () => [Notification.permission, (await navigator.permissions.query({ name: 'notifications' })).state])()`);

describe('notificações', () => {
  // Regressão: sem decisão, o site via "denied" e nunca pedia (WhatsApp, Gmail…).
  it('sem decisão: o site enxerga "perguntar"', async () => {
    expect(await seen(page)).toEqual(['default', 'prompt']);
    expect(await page.eval<boolean>(`new Notification('x') instanceof Notification`)).toBe(true); // construtor continua funcionando
  });

  it('o site pede → barra do Apollo → permitir (sem lembrar) → "granted" e notificação funciona', async () => {
    await page.mouseClick('#pedir');
    const s = await app.until((x) => x.permissionPrompt?.kinds.includes('notifications'), 'barra de permissão');
    await app.send({ type: 'permission:answer', promptId: s.permissionPrompt!.id, decision: 'allow', remember: false });
    await waitFor(async () => (await page.eval<string[]>('window.log')).includes('pedido:granted'), 'site recebeu granted');
    expect(await seen(page)).toEqual(['granted', 'granted']);
    await page.eval(`location.reload(); true`);
    await waitFor(async () => { try { return (await seen(page))[0] === 'granted'; } catch { return false; } }, 'continua permitido após recarregar');
  });

  it('bloqueado: o site vê "denied" e o pedido nem pergunta', async () => {
    const other = site.url.replace('127.0.0.1', 'localhost');
    await app.send({ type: 'permission:set', origin: other, kind: 'notifications', decision: 'deny' });
    await app.send({ type: 'tab:new', url: `${other}/notify?title=Outro` });
    await app.until((x) => app.activeTab(x).title === 'Outro' && !app.activeTab(x).loading, 'outro site');
    const p2 = await app.page(`${other}/notify`);
    expect(await seen(p2)).toEqual(['denied', 'denied']);
    await p2.mouseClick('#pedir');
    await waitFor(async () => (await p2.eval<string[]>('window.log')).includes('pedido:denied'), 'negado direto');
    expect((await app.state()).permissionPrompt).toBeNull();
    p2.close();
  });

  it('clique falso (sem ativação do usuário) não troca de aba', async () => {
    // A ativação de um clique real dura ~5 s (o clique em "Ativar notificações" acima): espera passar.
    await waitFor(() => page.eval<boolean>('!navigator.userActivation.isActive'), 'ativação expirar', 8000);
    const before = (await app.state()).activeTabId;
    await page.eval(`document.dispatchEvent(new CustomEvent('apollo-notification-click')); true`);
    await new Promise((r) => setTimeout(r, 500));
    expect((await app.state()).activeTabId).toBe(before);
  });

  it('clique com ativação real leva à aba da notificação (mesmo em outro workspace)', async () => {
    const s0 = await app.state();
    const target = s0.tabs.find((t) => t.title === 'Mensagens')!.id;
    // Sai para outro workspace; a aba da notificação fica em segundo plano.
    await app.send({ type: 'workspace:create', name: 'Outro', color: '#22aa66', home: '' });
    await app.until((x) => x.workspaces.length === 2 && x.activeWorkspaceId !== s0.activeWorkspaceId, 'outro workspace');
    await page.mouseClick('#simular'); // ativação real na página da notificação
    await app.until((x) => x.activeWorkspaceId === s0.activeWorkspaceId && x.activeTabId === target, 'voltou para a aba');
  });
});

describe('notificações em painel', () => {
  it('painel também enxerga "perguntar"; permitir pelo menu do painel vale', async () => {
    // Workspace "Outro": lá o site ainda não tem decisão (no primeiro, foi permitido acima).
    const outro = (await app.state()).workspaces.find((w) => w.name === 'Outro')!;
    await app.send({ type: 'panel:add', url: `${site.url}/notify?title=Painel`, workspaceId: outro.id, mobile: false });
    const panel = await app.page(`${site.url}/notify?title=Painel`);
    await waitFor(async () => { try { return (await seen(panel))[0] === 'default'; } catch { return false; } }, 'painel: perguntar');
    await app.send({ type: 'workspace:switch', workspaceId: outro.id }); // permission:set vale para o workspace ativo
    await app.send({ type: 'permission:set', origin: site.url, kind: 'notifications', decision: 'allow' });
    await panel.eval(`location.reload(); true`);
    await waitFor(async () => { try { return (await seen(panel))[0] === 'granted'; } catch { return false; } }, 'painel: permitido');
    panel.close();
  });
});
