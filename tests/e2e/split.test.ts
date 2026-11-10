// Tela dividida: duas abas lado a lado, divisória, metade ativa pelo clique, persistência.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
  for (const [i, t] of ['Esquerda', 'Direita', 'Terceira'].entries()) {
    if (i) await app.send({ type: 'tab:new' });
    await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=${t}` });
    ids[t] = (await app.until((s) => app.activeTab(s).title === t && !app.activeTab(s).loading, t)).activeTabId!;
  }
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const page = (t: string) => app.page(`${site.url}/page?title=${t}`);
const width = async (t: string) => { const p = await page(t); const w = await p.eval<number>('innerWidth'); p.close(); return w; };
const visible = async (t: string) => { const p = await page(t); const v = await p.eval<string>('document.visibilityState'); p.close(); return v === 'visible'; };
const viewsWidth = () => app.ui.eval<number>(`document.getElementById('views').clientWidth`);

describe('tela dividida', () => {
  it('aba ativa + outra lado a lado, meio a meio, as duas visíveis', async () => {
    await app.send({ type: 'tab:activate', tabId: ids.Esquerda });
    await app.send({ type: 'split:open', tabId: ids.Direita });
    const s = await app.until((x) => x.split !== null, 'dividida');
    expect(s.split).toMatchObject({ a: ids.Esquerda, b: ids.Direita, ratio: 0.5 });
    const half = Math.round((await viewsWidth() - 6) / 2);
    await waitFor(async () => Math.abs((await width('Esquerda')) - half) <= 1 && Math.abs((await width('Direita')) - half) <= 1, 'meio a meio');
    expect(await visible('Esquerda')).toBe(true);
    expect(await visible('Direita')).toBe(true);
    expect(await app.ui.eval<boolean>(`!document.getElementById('split-divider').hidden`)).toBe(true);
    expect(await app.ui.eval<number>(`document.querySelectorAll('#tabs .tab.in-split').length`)).toBe(2);
  });

  it('arrastar a divisória muda a proporção', async () => {
    await app.ui.drag('#split-divider', -200);
    await app.until((x) => x.split!.ratio < 0.45, 'proporção menor');
    await waitFor(async () => (await width('Esquerda')) < (await width('Direita')) - 100, 'esquerda menor');
    await app.ui.doubleClick('#split-divider');
    await app.until((x) => x.split!.ratio === 0.5, 'meio a meio de novo');
  });

  it('clicar na outra metade a torna a ativa (barra de endereço acompanha)', async () => {
    const p = await page('Direita');
    await p.mouseClick('body');
    p.close();
    const s = await app.until((x) => x.activeTabId === ids.Direita, 'direita ativa');
    expect(s.split).not.toBeNull();
    await waitFor(() => app.ui.eval<boolean>(`document.getElementById('address').value.includes('Direita')`), 'endereço');
    expect(await visible('Esquerda')).toBe(true); // continua ao lado
  });

  it('outra aba: as duas somem; voltar restaura a divisão', async () => {
    await app.send({ type: 'tab:activate', tabId: ids.Terceira });
    await waitFor(async () => !(await visible('Esquerda')) && !(await visible('Direita')), 'escondidas');
    expect(await app.ui.eval<boolean>(`document.getElementById('split-divider').hidden`)).toBe(true);
    await app.send({ type: 'tab:activate', tabId: ids.Esquerda });
    await waitFor(async () => (await visible('Direita')) && (await visible('Esquerda')), 'de volta lado a lado');
  });

  it('sobrevive ao reinício', async () => {
    await app.quit();
    app = await Apollo.launch(profile.dir);
    const s = await app.until((x) => x.split !== null, 'divisão restaurada');
    expect(s.split).toMatchObject({ a: ids.Esquerda, b: ids.Direita });
  });

  it('trocar os lados e sair', async () => {
    await app.send({ type: 'tab:activate', tabId: ids.Esquerda });
    await app.send({ type: 'split:swap' });
    await app.until((x) => x.split?.a === ids.Direita, 'trocado');
    await app.send({ type: 'split:close' });
    await app.until((x) => x.split === null, 'desfeita');
    await waitFor(async () => (await width('Esquerda')) === await viewsWidth(), 'largura inteira');
  });

  it('fechar uma das abas desfaz a divisão', async () => {
    await app.send({ type: 'split:open', tabId: ids.Terceira });
    await app.until((x) => x.split !== null, 'dividida');
    await app.send({ type: 'tab:close', tabId: ids.Terceira });
    await app.until((x) => x.split === null, 'desfeita ao fechar');
  });
});
