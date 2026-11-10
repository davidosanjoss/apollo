// Downloads: pasta Downloads com nome único, lista com progresso, pausar/retomar/cancelar.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;
let dir: string;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  dir = path.join(profile.dir, 'Baixados');
  fs.mkdirSync(dir);
  app = await Apollo.launch(profile.dir, { APOLLO_TEST_DOWNLOADS_DIR: dir });
  await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=Base` });
  await app.until((s) => app.activeTab(s).title === 'Base' && !app.activeTab(s).loading, 'página');
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const ui = <T>(js: string) => app.ui.eval<T>(js);
const download = (p: string) => app.send({ type: 'tab:navigate', url: `${site.url}${p}` });

describe('downloads', () => {
  it('vai direto para a pasta, sem perguntar; a aba continua na página', async () => {
    await download('/file?name=nota.pdf');
    const s = await app.until((x) => x.downloads[0]?.state === 'completed', 'concluído');
    expect(s.downloads[0]).toMatchObject({ filename: 'nota.pdf', total: 2048 });
    expect(fs.readFileSync(path.join(dir, 'nota.pdf')).length).toBe(2048);
    expect(app.activeTab(s).title).toBe('Base');
    expect(await ui<boolean>(`!document.getElementById('downloads-btn').hidden`)).toBe(true);
  });

  it('mesmo nome de novo: "nota (1).pdf" (não sobrescreve)', async () => {
    await download('/file?name=nota.pdf');
    const s = await app.until((x) => x.downloads.length === 2 && x.downloads[0].state === 'completed', 'segundo');
    expect(s.downloads[0].filename).toBe('nota (1).pdf');
    expect(fs.readdirSync(dir).sort()).toEqual(['nota (1).pdf', 'nota.pdf']);
  });

  it('lista na interface com status', async () => {
    await app.ui.mouseClick('#downloads-btn');
    await waitFor(() => ui<boolean>(`document.getElementById('downloads-dialog').open`), 'lista aberta');
    const rows = await ui<string[][]>(`[...document.querySelectorAll('#downloads-list li')].map((li) =>
      [li.querySelector('.name').textContent, li.querySelector('.status').textContent])`);
    expect(rows).toEqual([['nota (1).pdf', 'Concluído — 2 KB'], ['nota.pdf', 'Concluído — 2 KB']]);
  });

  it('download lento: progresso, pausar, retomar e terminar', async () => {
    await download('/slow-file');
    let s = await app.until((x) => x.downloads[0]?.filename === 'grande.bin' && x.downloads[0].received > 0, 'começou');
    const id = s.downloads[0].id;
    expect(s.downloads[0].total).toBe(1024 * 1024);
    await waitFor(() => ui<boolean>(`!!document.querySelector('#downloads-list li[data-download-id="${id}"] progress')`), 'barra de progresso');
    await app.ui.mouseClick(`#downloads-list li[data-download-id="${id}"] button[title="Pausar"]`);
    s = await app.until((x) => x.downloads[0].state === 'paused', 'pausado');
    const paused = s.downloads[0].received;
    await new Promise((r) => setTimeout(r, 800));
    expect((await app.state()).downloads[0].received).toBe(paused); // parado mesmo
    await app.send({ type: 'download:action', downloadId: id, action: 'resume' });
    await app.until((x) => x.downloads[0].state === 'completed', 'terminou', 20_000);
    expect(fs.statSync(path.join(dir, 'grande.bin')).size).toBe(1024 * 1024);
  });

  it('cancelar um download em andamento', async () => {
    await download('/slow-file');
    const s = await app.until((x) => x.downloads[0]?.filename === 'grande (1).bin' && x.downloads[0].received > 0, 'começou');
    await app.send({ type: 'download:action', downloadId: s.downloads[0].id, action: 'cancel' });
    await app.until((x) => x.downloads[0].state === 'cancelled', 'cancelado');
    expect(fs.existsSync(path.join(dir, 'grande (1).bin'))).toBe(false);
  });

  it('"Limpar a lista" tira o que terminou (os arquivos ficam)', async () => {
    await app.ui.mouseClick('#downloads-clear');
    await app.until((x) => x.downloads.length === 0, 'lista vazia');
    expect(fs.readdirSync(dir)).toHaveLength(3);
    await ui(`document.getElementById('downloads-dialog').close(); true`);
    // O botão fica sempre no rodapé da barra direita; sem nada baixando, sem contador.
    await waitFor(async () => ui<boolean>(`document.getElementById('downloads-active').hidden`), 'sem contador');
  });

  it('opção "perguntar onde salvar" fica salva', async () => {
    await app.send({ type: 'settings:download-ask', ask: true });
    await app.until((s) => s.settings.downloadAsk, 'ligada');
    await app.send({ type: 'settings:download-ask', ask: false });
    await app.until((s) => !s.settings.downloadAsk, 'desligada');
  });
});
