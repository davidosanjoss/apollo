import type { Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { NetworkPipeline, gpcModule, type NetworkModule } from '../../src/main/network';

type Listener = (details: Record<string, unknown>, cb: (r: object) => void) => void;

function fakeSession() {
  const l: Record<string, Listener> = {};
  const webRequest = {
    onBeforeRequest: vi.fn((fn: Listener) => { l.before = fn; }),
    onBeforeSendHeaders: vi.fn((fn: Listener) => { l.send = fn; }),
    onHeadersReceived: vi.fn((fn: Listener) => { l.received = fn; }),
  };
  return { ses: { webRequest } as unknown as Session, webRequest, l };
}

const call = (fn: Listener, details: Record<string, unknown>) => {
  let out: object | undefined;
  fn(details, (r) => { out = r; });
  return out;
};

describe('NetworkPipeline', () => {
  it('sem módulos não registra nenhum listener (custo zero)', () => {
    const { ses, webRequest } = fakeSession();
    new NetworkPipeline([], () => null).attach(ses, 'w');
    expect(webRequest.onBeforeRequest).not.toHaveBeenCalled();
    expect(webRequest.onBeforeSendHeaders).not.toHaveBeenCalled();
    expect(webRequest.onHeadersReceived).not.toHaveBeenCalled();
  });

  it('registra só os hooks usados', () => {
    const { ses, webRequest } = fakeSession();
    new NetworkPipeline([gpcModule], () => null).attach(ses, 'w');
    expect(webRequest.onBeforeSendHeaders).toHaveBeenCalledOnce();
    expect(webRequest.onBeforeRequest).not.toHaveBeenCalled();
  });

  it('GPC adiciona Sec-GPC: 1 sem perder os cabeçalhos originais', () => {
    const { ses, l } = fakeSession();
    new NetworkPipeline([gpcModule], () => null).attach(ses, 'w');
    expect(call(l.send, { requestHeaders: { Accept: 'text/html' } }))
      .toEqual({ requestHeaders: { Accept: 'text/html', 'Sec-GPC': '1' } });
  });

  it('passa workspace e aba para os módulos', () => {
    const { ses, l } = fakeSession();
    const seen = vi.fn();
    const mod: NetworkModule = { name: 'spy', onBeforeRequest: (_d, ctx) => { seen(ctx); } };
    new NetworkPipeline([mod], (id) => (id === 7 ? 'tab7' : null)).attach(ses, 'ws1');
    call(l.before, { webContentsId: 7 });
    call(l.before, {});
    expect(seen).toHaveBeenNthCalledWith(1, { workspaceId: 'ws1', tabId: 'tab7' });
    expect(seen).toHaveBeenNthCalledWith(2, { workspaceId: 'ws1', tabId: null });
  });

  it('o primeiro módulo que cancela/redireciona decide; os seguintes não rodam', () => {
    const { ses, l } = fakeSession();
    const later = vi.fn();
    new NetworkPipeline([
      { name: 'passa', onBeforeRequest: () => undefined },
      { name: 'bloqueia', onBeforeRequest: () => ({ cancel: true }) },
      { name: 'depois', onBeforeRequest: later },
    ], () => null).attach(ses, 'w');
    expect(call(l.before, {})).toEqual({ cancel: true });
    expect(later).not.toHaveBeenCalled();
  });

  it('módulo com erro não quebra a navegação nem os outros módulos', () => {
    const { ses, l } = fakeSession();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new NetworkPipeline([
      { name: 'bugado', onBeforeSendHeaders: () => { throw new Error('boom'); } },
      gpcModule,
    ], () => null).attach(ses, 'w');
    expect(call(l.send, { requestHeaders: {} })).toEqual({ requestHeaders: { 'Sec-GPC': '1' } });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('cabeçalhos de resposta podem ser alterados; resposta sem cabeçalhos não quebra', () => {
    const { ses, l } = fakeSession();
    new NetworkPipeline([{ name: 'csp', onHeadersReceived: (_d, headers) => { headers['X-Test'] = ['1']; } }], () => null)
      .attach(ses, 'w');
    expect(call(l.received, { responseHeaders: { A: ['b'] } })).toEqual({ responseHeaders: { A: ['b'], 'X-Test': ['1'] } });
    expect(call(l.received, {})).toEqual({ responseHeaders: { 'X-Test': ['1'] } });
  });
});
