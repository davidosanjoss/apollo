// Navegador padrão: links vindos de fora (ao abrir e com o Apollo já aberto).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, launchSecond, startSite, tempProfile, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

describe('links de outros programas', () => {
  it('aberto com um link: usa a aba vazia', async () => {
    app = await Apollo.launch(profile.dir, {}, [`${site.url}/page?title=Inicial`]);
    const s = await app.until((x) => app.activeTab(x).title === 'Inicial', 'link de partida');
    expect(s.tabs).toHaveLength(1);
  });

  it('com o Apollo aberto: a segunda chamada entrega o link numa aba nova e sai', async () => {
    const code = await launchSecond(profile.dir, ['--no-sandbox-nao-usado', `${site.url}/page?title=Externo`]);
    expect(code).toBe(0);
    const s = await app.until((x) => app.activeTab(x).title === 'Externo', 'link externo');
    expect(s.tabs.map((t) => t.title)).toEqual(['Inicial', 'Externo']);
  });

  it('o estado de navegador padrão chega às Configurações', async () => {
    expect([true, false, null]).toContain((await app.state()).settings.defaultBrowser);
  });
});
