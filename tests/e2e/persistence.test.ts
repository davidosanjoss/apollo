import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
beforeAll(async () => { site = await startSite(); });
afterAll(async () => { await site?.close(); });

describe('persistência entre reinícios', () => {
  it('reabre com os mesmos workspaces, abas na mesma ordem e login mantido', async () => {
    const profile = tempProfile();
    try {
      let app = await Apollo.launch(profile.dir);
      await app.send({ type: 'workspace:create', name: 'Faculdade', color: '#00aa00', home: '' });
      let s = await app.until((x) => x.workspaces.length === 2, 'workspace criado');
      const ws = s.activeWorkspaceId!;

      for (const title of ['A', 'B', 'C']) {
        if (title !== 'A') await app.send({ type: 'tab:new' });
        await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=${title}` });
        await app.until((x) => app.activeTab(x).title === title, `aba ${title}`);
      }
      await app.send({ type: 'tab:new' });
      await app.send({ type: 'tab:navigate', url: `${site.url}/set-cookie?v=faculdade` });
      await app.until((x) => app.activeTab(x).url.includes('set-cookie') && !app.activeTab(x).loading, 'cookie gravado');
      s = await app.state();
      const before = s.tabs.map((t) => t.url);
      const activeIdx = s.tabs.findIndex((t) => t.id === s.activeTabId);
      await app.quit();

      app = await Apollo.launch(profile.dir);
      try {
        s = await app.state();
        expect(s.workspaces.map((w) => w.name)).toEqual(['Principal', 'Faculdade']);
        expect(s.activeWorkspaceId).toBe(ws);
        expect(s.tabs.map((t) => t.url)).toEqual(before);
        expect(s.tabs.findIndex((t) => t.id === s.activeTabId)).toBe(activeIdx);

        await app.send({ type: 'tab:navigate', url: `${site.url}/cookie` });
        const page = await app.page(`${site.url}/cookie`);
        // A aba pode trocar de documento enquanto conectamos: espera o corpo da página certa.
        await waitFor(async () => (await page.eval<string | null>('document.body?.textContent ?? null')) === 'login=faculdade',
          'cookie persistente após reinício');
        page.close();
      } finally {
        await app.quit();
      }
    } finally {
      profile.cleanup();
    }
  });

  it('migra o state.json da v0.1.0 mantendo ids (logins) e ordem', async () => {
    const profile = tempProfile();
    const legacy = {
      activeWorkspaceId: 'bbbbbbbbbbbb',
      workspaces: [
        { id: 'aaaaaaaaaaaa', name: 'Pessoal', color: '#ff0000', home: `${site.url}/page?title=P`,
          tabs: [{ id: 't1', url: `${site.url}/page?title=P1`, title: 'P1' }] },
        { id: 'bbbbbbbbbbbb', name: 'Trabalho', color: '#0000ff', home: `${site.url}/page?title=T`, activeTabId: 't3',
          tabs: [{ id: 't2', url: `${site.url}/page?title=T1`, title: 'T1' }, { id: 't3', url: `${site.url}/page?title=T2`, title: 'T2' }] },
      ],
    };
    fs.writeFileSync(path.join(profile.dir, 'state.json'), JSON.stringify(legacy));
    const app = await Apollo.launch(profile.dir);
    try {
      const s = await app.state();
      expect(s.workspaces.map((w) => [w.id, w.name])).toEqual([['aaaaaaaaaaaa', 'Pessoal'], ['bbbbbbbbbbbb', 'Trabalho']]);
      expect(s.activeWorkspaceId).toBe('bbbbbbbbbbbb');
      expect(s.tabs.map((t) => t.id)).toEqual(['t2', 't3']);
      expect(s.activeTabId).toBe('t3');
      expect(fs.existsSync(path.join(profile.dir, 'state.json.migrated'))).toBe(true);
    } finally {
      await app.quit();
      profile.cleanup();
    }
  });

  // Regressão: state.json corrompido derrubava a inicialização.
  it('abre normalmente com state.json corrompido', async () => {
    const profile = tempProfile();
    fs.writeFileSync(path.join(profile.dir, 'state.json'), '{"workspaces": [');
    const app = await Apollo.launch(profile.dir);
    try {
      const s = await app.state();
      expect(s.workspaces.map((w) => w.name)).toEqual(['Principal']);
    } finally {
      await app.quit();
      profile.cleanup();
    }
  });
});
