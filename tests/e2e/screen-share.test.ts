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

// Regressão (relatado): no Teams a tela compartilhada chegava preta para os outros. A captura
// estava certa; o H.264 codificado pela placa (VA-API) não decodificava do outro lado. Aqui a
// aba compartilhada vai por uma chamada WebRTC local em H.264 e a imagem precisa chegar.
// (No CI, sem placa de vídeo, confere o caminho em software; com APOLLO_E2E_SHOW=1, o real.)
describe('compartilhar tela numa chamada', () => {
  it('o vídeo em H.264 chega ao outro lado com imagem (não preto)', async () => {
    await meeting.eval(`(() => { window.chamada = null; document.getElementById('compartilhar').onclick = async () => { try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const a = new RTCPeerConnection(), b = new RTCPeerConnection();
      a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
      b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
      const tr = a.addTransceiver(s.getVideoTracks()[0], { direction: 'sendonly' });
      tr.setCodecPreferences(RTCRtpSender.getCapabilities('video').codecs.filter((c) => c.mimeType === 'video/H264'));
      const remoto = new Promise((r) => { b.ontrack = (e) => r(new MediaStream([e.track])); });
      await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription);
      const v = document.createElement('video'); v.muted = true; v.srcObject = await remoto; document.body.append(v);
      await v.play();
      await new Promise((r) => setTimeout(r, 1500));
      const c = document.createElement('canvas'); c.width = 32; c.height = 18;
      const g = c.getContext('2d'); g.drawImage(v, 0, 0, 32, 18);
      const d = g.getImageData(0, 0, 32, 18).data; let t = 0;
      for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2];
      let quadros = 0;
      (await b.getStats()).forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'video') quadros = x.framesDecoded; });
      window.chamada = JSON.stringify({ quadros, brilho: Math.round(t / (d.length / 4) / 3) });
      a.close(); b.close(); s.getTracks().forEach((x) => x.stop());
    } catch (e) { window.chamada = 'erro:' + e.name; } }; return true; })()`);
    await meeting.mouseClick('#compartilhar');
    const s = await app.until((x) => x.screenPicker !== null, 'seletor aberto');
    await app.send({ type: 'screen:pick', requestId: s.screenPicker!.id, sourceId: `tab:${sharedTabId}`, audio: false });
    const r = await waitFor(() => meeting.eval<string>('window.chamada || ""'), 'imagem do outro lado', 20000);
    const { quadros, brilho } = JSON.parse(r) as { quadros: number; brilho: number };
    expect(quadros).toBeGreaterThan(0); // o outro lado decodificou
    // A aba "Slides" é branca. No modo sem janela (CI) a aba capturada não tem imagem: só os quadros.
    if (process.env.APOLLO_E2E_SHOW || process.platform !== 'linux') expect(brilho).toBeGreaterThan(200);
  });
});
