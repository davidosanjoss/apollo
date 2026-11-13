// Barra de endereço como no Opera: pesquisas sugeridas pelo buscador (aqui, um falso) e,
// abaixo, o histórico local. Desligável; nunca nos workspaces temporários.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let api: http.Server;
const asked: { q: string; cookie: string | undefined }[] = [];

beforeAll(async () => {
  api = http.createServer((req, res) => {
    const q = new URL(req.url ?? '/', 'http://x').searchParams.get('q') ?? '';
    asked.push({ q, cookie: req.headers.cookie });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify([q, [`${q} de cenoura`, `${q} de fubá`]]));
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir, { APOLLO_SUGGEST_API: `http://127.0.0.1:${(api.address() as AddressInfo).port}/s?q=` });
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  api?.close();
  profile?.cleanup();
});

const ui = <T>(js: string) => app.ui.eval<T>(js);
async function type(text: string) {
  await ui(`(() => { const a = document.getElementById('address'); a.focus(); a.value = ''; return true; })()`);
  await app.ui.call('Input.insertText', { text });
}
const closeBar = () => ui(`document.getElementById('address').blur(); true`);

describe('sugestões de pesquisa na barra de endereço', () => {
  it('pesquisas do buscador primeiro, histórico local embaixo', async () => {
    await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=${encodeURIComponent('Bolo de laranja')}` });
    await app.until((s) => app.activeTab(s).title === 'Bolo de laranja' && !app.activeTab(s).loading, 'visitou');
    await app.send({ type: 'tab:new' });
    await app.until((s) => app.activeTab(s).url.startsWith('apollo://home'), 'aba nova');
    await type('bolo');
    const s = await app.until((x) => x.addressSuggest?.items.some((i) => i.kind === 'search'), 'pesquisas sugeridas');
    expect(s.addressSuggest!.items.map((i) => [i.kind, i.title])).toEqual([
      ['search', 'bolo de cenoura'], ['search', 'bolo de fubá'], ['history', 'Bolo de laranja'],
    ]);
    expect(asked.at(-1)).toEqual({ q: 'bolo', cookie: undefined }); // só o texto, sem cookies
    const popup = await app.page('apollo://suggest');
    await waitFor(async () => (await popup.eval<number>(`document.querySelectorAll('#list li').length`)) === 3, 'lista com 3');
    expect(await popup.eval<boolean>(`document.querySelectorAll('#list li')[2].classList.contains('divider')`)).toBe(true);
  });

  it('seta numa pesquisa mostra o texto na barra (não o endereço do buscador)', async () => {
    await app.ui.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await app.ui.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    expect(await ui<string>(`document.getElementById('address').value`)).toBe('bolo de cenoura');
    await closeBar();
    await app.until((s) => !s.addressSuggest, 'fechou');
  });

  it('desligado nas configurações: só o local, nada vai para o buscador', async () => {
    await app.send({ type: 'settings:search-suggest', on: false });
    await app.until((s) => !s.settings.searchSuggest, 'desligou');
    const before = asked.length;
    await type('laranja');
    const s = await app.until((x) => x.addressSuggest?.text === 'laranja', 'sugestões locais');
    await new Promise((r) => setTimeout(r, 400));
    expect((await app.state()).addressSuggest!.items.map((i) => i.kind)).toEqual(['history']);
    expect(s.addressSuggest!.items[0].title).toBe('Bolo de laranja');
    expect(asked.length).toBe(before);
    await closeBar();
    await app.send({ type: 'settings:search-suggest', on: true });
  });

  it('workspace temporário: nada vai para o buscador', async () => {
    await app.send({ type: 'workspace:create', name: 'Anônimo', color: '#888888', home: '', temporary: true });
    await app.until((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.temporary, 'temporário');
    const before = asked.length;
    await type('segredo');
    await app.until((x) => x.addressSuggest?.text === 'segredo', 'barra respondeu');
    await new Promise((r) => setTimeout(r, 400));
    expect(asked.length).toBe(before);
    await closeBar();
  });
});
