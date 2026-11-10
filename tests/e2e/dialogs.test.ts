// A página (view nativa) fica POR CIMA da interface: com qualquer diálogo aberto ela
// precisa estar escondida, senão cobre o diálogo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
const URL_ = () => `${site.url}/page?title=Fundo`;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
  await app.send({ type: 'tab:navigate', url: URL_() });
  await app.until((s) => app.activeTab(s).title === 'Fundo', 'página');
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const pageVisibility = async () => {
  const p = await app.page(URL_());
  const v = await p.eval<string>('document.visibilityState');
  p.close();
  return v;
};
const isOpen = (id: string) => app.ui.eval<boolean>(`document.getElementById('${id}').open`);

describe('diálogos escondem a página', () => {
  // Regressão: ⚙ → "Módulos e personalizações…" deixava a tela escura sem o diálogo:
  // o aviso de "Configurações fechou" chegava depois de o diálogo de módulos abrir e a
  // página voltava por cima dele.
  it('trocar de um diálogo para outro (Configurações → Módulos) mantém a página escondida', async () => {
    await app.ui.mouseClick('#settings-btn');
    await waitFor(() => isOpen('settings-dialog'), 'configurações');
    await waitFor(async () => (await pageVisibility()) === 'hidden', 'página escondida');
    await app.ui.mouseClick('#open-modules');
    await waitFor(() => isOpen('modules-dialog'), 'módulos');
    await new Promise((r) => setTimeout(r, 400)); // tempo de o aviso atrasado chegar
    expect(await isOpen('settings-dialog')).toBe(false);
    expect(await pageVisibility()).toBe('hidden');
  });

  it('fechar o último diálogo mostra a página de novo', async () => {
    await app.ui.eval(`document.getElementById('modules-dialog').close(); true`);
    await waitFor(async () => (await pageVisibility()) === 'visible', 'página visível');
  });

  it('paleta → Configurações (pela paleta) também', async () => {
    await app.ui.mouseClick('#palette-btn');
    await waitFor(() => isOpen('palette'), 'paleta');
    await app.ui.eval(`(() => { const i = document.getElementById('palette-input'); i.value = 'configuracoes'; i.dispatchEvent(new Event('input'));
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return true; })()`);
    await waitFor(() => isOpen('settings-dialog'), 'configurações pela paleta');
    await new Promise((r) => setTimeout(r, 400));
    expect(await pageVisibility()).toBe('hidden');
    await app.ui.eval(`document.getElementById('settings-dialog').close(); true`);
    await waitFor(async () => (await pageVisibility()) === 'visible', 'visível');
  });
});
