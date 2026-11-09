// Fase 2a: a sessão volta como se o navegador nunca tivesse fechado.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
beforeAll(async () => { site = await startSite(); });
afterAll(async () => { await site?.close(); });

async function go(app: Apollo, url: string) {
  await app.send({ type: 'tab:navigate', url });
  return app.until((s) => app.activeTab(s).url === url && !app.activeTab(s).loading, `navegar para ${url}`);
}

async function bodyOf(app: Apollo, url: string) {
  const page = await app.page(url);
  await waitFor(async () => (await page.eval<string>('document.readyState')) === 'complete', 'página carregada');
  const text = await waitFor(() => page.eval<string | null>('document.body?.textContent ?? null'), 'corpo da página');
  page.close();
  return text;
}

describe('restauração da sessão', () => {
  it('cookie de SESSÃO (login) sobrevive a fechar e abrir', async () => {
    const profile = tempProfile();
    try {
      let app = await Apollo.launch(profile.dir);
      await go(app, `${site.url}/set-session-cookie?v=logado`);
      await go(app, `${site.url}/cookie`);
      expect(await bodyOf(app, `${site.url}/cookie`)).toContain('sessao=logado');
      await app.quit();

      app = await Apollo.launch(profile.dir);
      try {
        await app.send({ type: 'tab:reload' });
        await app.until((s) => app.activeTab(s).url === `${site.url}/cookie`, 'aba restaurada');
        await waitFor(async () => (await bodyOf(app, `${site.url}/cookie`)).includes('sessao=logado'), 'cookie de sessão restaurado', 5000);
      } finally {
        await app.quit();
      }
    } finally {
      profile.cleanup();
    }
  });

  // Regressão: navegar enquanto os cookies de sessão ainda eram restaurados era
  // desfeito — a restauração do histórico terminava depois e voltava à página antiga.
  it('navegar logo ao abrir (antes de restaurar a sessão) não é desfeito', async () => {
    const profile = tempProfile();
    try {
      let app = await Apollo.launch(profile.dir);
      await go(app, `${site.url}/page?title=Antiga`);
      await app.quit();

      app = await Apollo.launch(profile.dir, { APOLLO_TEST_SESSION_RESTORE_DELAY_MS: '1500' });
      try {
        await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=Nova` });
        await app.until((s) => app.activeTab(s).title === 'Nova' && !app.activeTab(s).loading, 'página nova carregada', 8000);
        await new Promise((r) => setTimeout(r, 1000));
        const s = await app.state();
        expect(app.activeTab(s).url).toBe(`${site.url}/page?title=Nova`);
        expect(app.activeTab(s).canGoBack).toBe(true); // a antiga continua no histórico
      } finally {
        await app.quit();
      }
    } finally {
      profile.cleanup();
    }
  });

  it('voltar/avançar funcionam depois de reabrir', async () => {
    const profile = tempProfile();
    try {
      let app = await Apollo.launch(profile.dir);
      for (const p of ['A', 'B', 'C']) await go(app, `${site.url}/page?title=${p}`);
      await app.send({ type: 'tab:back' });
      await app.until((s) => app.activeTab(s).url.endsWith('title=B'), 'voltar para B');
      await app.quit();

      app = await Apollo.launch(profile.dir);
      try {
        let s = await app.until((x) => app.activeTab(x).url.endsWith('title=B') && app.activeTab(x).canGoBack, 'B com histórico');
        expect(app.activeTab(s).canGoForward).toBe(true);
        await app.send({ type: 'tab:forward' });
        await app.until((x) => app.activeTab(x).url.endsWith('title=C'), 'avançar para C');
        await app.send({ type: 'tab:back' });
        await app.send({ type: 'tab:back' });
        s = await app.until((x) => app.activeTab(x).url.endsWith('title=A'), 'voltar até A');
        expect(app.activeTab(s).canGoBack).toBe(true); // ainda tem a página inicial antes
      } finally {
        await app.quit();
      }
    } finally {
      profile.cleanup();
    }
  });
});

// O atalho Ctrl+Shift+T → 'reopen-tab' é coberto em tests/unit/shortcuts.test.ts
// (teclas injetadas via CDP não passam pelo before-input-event do Electron).
describe('reabrir aba fechada', () => {
  let app: Apollo;
  let profile: ReturnType<typeof tempProfile>;
  beforeAll(async () => { profile = tempProfile(); app = await Apollo.launch(profile.dir); });
  afterAll(async () => { await app?.quit(); profile?.cleanup(); });

  it('volta no mesmo lugar, com o histórico', async () => {
    await go(app, `${site.url}/page?title=Primeira`);
    await app.send({ type: 'tab:new' });
    await go(app, `${site.url}/page?title=X1`);
    await go(app, `${site.url}/page?title=X2`);
    await app.send({ type: 'tab:new' });
    await go(app, `${site.url}/page?title=Ultima`);

    let s = await app.state();
    const closing = s.tabs[1];
    expect(closing.url).toMatch(/X2$/);
    await app.send({ type: 'tab:close', tabId: closing.id });
    await app.until((x) => x.tabs.length === 2, 'aba fechada');

    await app.send({ type: 'tab:reopen' });
    s = await app.until((x) => x.tabs.length === 3, 'aba reaberta');
    expect(s.tabs.map((t) => t.url.split('title=')[1])).toEqual(['Primeira', 'X2', 'Ultima']);
    expect(s.activeTabId).toBe(s.tabs[1].id);

    await app.until((x) => app.activeTab(x).canGoBack, 'histórico restaurado');
    await app.send({ type: 'tab:back' });
    await app.until((x) => app.activeTab(x).url.endsWith('title=X1'), 'voltar para X1');
  });

  it('sem abas fechadas, não faz nada', async () => {
    const before = (await app.state()).tabs.length;
    await app.send({ type: 'tab:reopen' });
    await new Promise((r) => setTimeout(r, 300));
    expect((await app.state()).tabs.length).toBe(before);
  });
});
