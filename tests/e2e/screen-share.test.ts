// Compartilhar tela (Teams, Meet…): seletor próprio; a escolha é o consentimento.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let meeting: Cdp;
let sharedTabId: string;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
  await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=Slides` });
  sharedTabId = (await app.until((s) => app.activeTab(s).title === 'Slides' && app.activeTab(s).live, 'slides')).activeTabId!;
  await app.send({ type: 'tab:new' });
  await app.send({ type: 'tab:navigate', url: `${site.url}/share` });
  await app.until((s) => app.activeTab(s).title === 'Reunião' && !app.activeTab(s).loading, 'reunião');
  meeting = await app.page(`${site.url}/share`);
});
afterAll(async () => {
  meeting?.close();
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const result = () => meeting.eval<string>('window.resultado');
async function ask() {
  await meeting.eval(`window.resultado = 'esperando'; true`);
  await meeting.mouseClick('#compartilhar'); // gesto real do usuário (exigido pelo getDisplayMedia)
  return app.until((s) => s.screenPicker !== null, 'seletor aberto');
}

// Regressão (janela real): a aba compartilhada estava escondida, sem desenhar quadros, e a
// captura ficava pendente para sempre — agora fica anexada fora da área visível.
describe('compartilhar tela', () => {
  it('pedido abre o seletor do Apollo com as abas (menos a própria reunião)', async () => {
    const s = await ask();
    const p = s.screenPicker!;
    expect(p.origin).toBe(site.url);
    expect(p.audioRequested).toBe(true);
    const tabs = p.sources.filter((x) => x.kind === 'tab');
    expect(tabs.map((t) => t.name)).toEqual(['Slides']);
    expect(await app.ui.eval<boolean>(`document.getElementById('screen-dialog').open`)).toBe(true);
    // Escolher pela interface (clique real) e compartilhar, sem áudio.
    await app.ui.mouseClick(`.screen-src[data-source-id="tab:${sharedTabId}"]`);
    await app.ui.mouseClick('#screen-share');
    await waitFor(async () => (await result()) !== 'esperando', 'resposta na página');
    expect(await result()).toBe('ok:video');
    expect((await app.state()).screenPicker).toBeNull();
  });

  it('com áudio marcado: a página recebe vídeo e áudio da aba', async () => {
    const s = await ask();
    await app.send({ type: 'screen:pick', requestId: s.screenPicker!.id, sourceId: `tab:${sharedTabId}`, audio: true });
    await waitFor(async () => (await result()) !== 'esperando', 'resposta');
    expect(await result()).toBe('ok:audio+video');
  });

  // O Electron entrega AbortError quando o pedido é negado (o Chrome usaria
  // NotAllowedError); para Teams/Meet o efeito é o mesmo: compartilhamento cancelado.
  it('cancelar (fechar o seletor): o compartilhamento é recusado', async () => {
    await ask();
    await app.ui.mouseClick('#screen-cancel');
    await waitFor(async () => (await result()) !== 'esperando', 'resposta');
    expect(await result()).toBe('erro:AbortError');
    expect((await app.state()).screenPicker).toBeNull();
  });
});
