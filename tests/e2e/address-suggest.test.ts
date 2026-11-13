// Barra de endereço: ao digitar, sugere do histórico (e favoritos/abas) do workspace,
// numa lista por cima da página, e completa o domínio na própria barra.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Apollo, startSite, tempProfile, waitFor, type Cdp, type TestSite } from './harness';

let site: TestSite;
let app: Apollo;
let profile: ReturnType<typeof tempProfile>;

beforeAll(async () => {
  site = await startSite();
  profile = tempProfile();
  app = await Apollo.launch(profile.dir);
});
afterAll(async () => {
  await app?.quit();
  await site?.close();
  profile?.cleanup();
});

const ui = <T>(js: string) => app.ui.eval<T>(js);
const address = () => ui<string>(`document.getElementById('address').value`);
async function visit(title: string) {
  await app.send({ type: 'tab:navigate', url: `${site.url}/page?title=${encodeURIComponent(title)}` });
  await app.until((s) => app.activeTab(s).title === title && !app.activeTab(s).loading, title);
}
/** Limpa a barra e digita como o usuário (teclado de verdade). */
async function type(text: string) {
  await ui(`(() => { const a = document.getElementById('address'); a.focus(); a.select(); return true; })()`);
  await app.ui.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await app.ui.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await app.ui.call('Input.insertText', { text });
}
async function key(k: 'ArrowDown' | 'ArrowUp' | 'Escape', code: number) {
  await app.ui.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code });
  await app.ui.call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
}
let popup: Cdp;
const shownTitles = () => popup.eval<string[]>(`[...document.querySelectorAll('#list li .title')].map((x) => x.textContent)`);

describe('sugestões da barra de endereço', () => {
  it('digitar mostra o histórico que casa (sem acento, qualquer ordem)', async () => {
    await visit('Cálculo Diferencial');
    await visit('Álgebra Linear');
    await app.send({ type: 'tab:new' });
    await app.until((s) => app.activeTab(s).url.startsWith('apollo://home'), 'aba nova');
    await waitFor(() => ui<boolean>(`document.activeElement.id === 'address'`), 'barra focada');
    await type('diferencial calculo');
    const s = await app.until((x) => (x.addressSuggest?.items.length ?? 0) > 0, 'sugestões');
    expect(s.addressSuggest!.items.map((i) => i.title)).toEqual(['Cálculo Diferencial']);
    popup = await app.page('apollo://suggest');
    expect(await waitFor(async () => ((await shownTitles()).length ? shownTitles() : null), 'lista desenhada')).toEqual(['Cálculo Diferencial']);
  });

  it('completa o domínio na barra; Enter vai para o site', async () => {
    const host = new URL(site.url).host; // 127.0.0.1:porta
    await type('127.0');
    await waitFor(async () => (await address()) === host, 'domínio completado');
    expect(await ui<string>(`(() => { const a = document.getElementById('address'); return a.value.slice(a.selectionStart, a.selectionEnd); })()`))
      .toBe(host.slice('127.0'.length)); // o resto fica selecionado: continuar digitando substitui
    // Apagando não completa de novo.
    await app.ui.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await app.ui.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await app.until((s) => s.addressSuggest?.text === '127.0', 'sugestões depois de apagar');
    expect(await address()).toBe('127.0');
  });

  it('setas escolhem a sugestão e Enter abre', async () => {
    await type('algebra');
    await app.until((s) => s.addressSuggest?.text === 'algebra' && s.addressSuggest.items.length === 1, 'sugestão');
    await key('ArrowDown', 40);
    expect(await address()).toContain('/page?title=');
    await waitFor(async () => popup.eval<boolean>(`document.querySelector('#list li').classList.contains('selected')`), 'destacada');
    await app.ui.pressEnter('#address');
    await app.until((s) => app.activeTab(s).title === 'Álgebra Linear' && !s.addressSuggest, 'abriu e fechou a lista');
  });

  it('clicar na lista abre; Esc fecha e volta ao digitado', async () => {
    await app.send({ type: 'tab:new' });
    await app.until((s) => app.activeTab(s).url.startsWith('apollo://home'), 'aba nova');
    await type('diferencial');
    await app.until((s) => s.addressSuggest?.text === 'diferencial' && s.addressSuggest.items.length > 0, 'sugestão');
    await key('ArrowDown', 40);
    await key('Escape', 27);
    await app.until((s) => !s.addressSuggest, 'lista fechada');
    expect(await address()).toBe('diferencial');
    expect(await ui<boolean>(`document.activeElement.id === 'address'`)).toBe(true); // segue digitando

    await type('diferencial');
    await app.until((s) => s.addressSuggest?.text === 'diferencial' && s.addressSuggest.items.length > 0, 'sugestão de novo');
    await waitFor(async () => (await shownTitles()).length > 0, 'lista desenhada');
    await popup.mouseClick('#list li');
    await app.until((s) => app.activeTab(s).title === 'Cálculo Diferencial' && !s.addressSuggest, 'abriu pelo clique');
  });
});
