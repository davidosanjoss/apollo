// Câmera e microfone nos painéis (pedido do usuário): o painel pergunta na barra de
// permissão; antes o pedido era negado direto (chamadas no WhatsApp do painel não iam).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let panel: Cdp;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir, {}, ['--use-fake-device-for-media-stream']);
  const s = await app.state();
  await app.send({ type: 'panel:add', url: `${site.url}/camera`, workspaceId: s.activeWorkspaceId, mobile: false });
  await app.until((x) => x.activePanelId !== null, 'painel aberto');
  panel = await app.page(`${site.url}/camera`);
  await waitFor(() => panel.eval<boolean>(`!!document.getElementById('ligar')`), 'página do painel');
});
afterAll(async () => {
  panel?.close();
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const resultado = () => panel.eval<string>('window.resultado');

describe('permissões nos painéis', () => {
  it('o pedido de câmera e microfone aparece na barra, marcado como painel; permitir libera', async () => {
    await panel.mouseClick('#ligar');
    const s = await app.until((x) => x.permissionPrompt?.panelId !== null && x.permissionPrompt?.panelId !== undefined, 'barra de permissão');
    expect(s.permissionPrompt!.kinds).toEqual(['media-video', 'media-audio']);
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('permission-text').textContent.includes('(painel)')`), 'texto');
    await app.ui.mouseClick('#permission-allow');
    await waitFor(async () => (await resultado()) !== 'nada', 'resposta');
    expect(await resultado()).toBe('ok:audio+video');
  });

  it('lembrado: a próxima chamada não pergunta de novo', async () => {
    await panel.eval(`window.resultado = 'nada'; true`);
    await panel.mouseClick('#ligar');
    await waitFor(async () => (await resultado()) !== 'nada', 'resposta direta');
    expect(await resultado()).toBe('ok:audio+video');
    expect((await app.state()).permissionPrompt).toBeNull();
  });

  it('bloqueado pelo menu do painel: a chamada é recusada sem perguntar', async () => {
    await app.send({ type: 'permission:set', origin: site.url, kind: 'media-video', decision: 'deny' });
    await panel.eval(`window.resultado = 'nada'; true`);
    await panel.mouseClick('#ligar');
    await waitFor(async () => (await resultado()) !== 'nada', 'resposta');
    expect(await resultado()).toBe('erro:NotAllowedError');
  });
});
