// O código injetado no mundo da página, avaliado contra um Notification falso.
import { describe, expect, it } from 'vitest';
import { notificationShim } from '../../src/preload/notifications';

function run(ask: boolean, real: 'denied' | 'granted') {
  let perm = real;
  class FakeNotification extends EventTarget {
    static get permission() { return perm; }
    static requestPermission() { perm = 'granted'; return Promise.resolve(perm); }
    constructor(readonly title: string) { super(); }
  }
  const events: string[] = [];
  const document = { dispatchEvent: (e: Event) => events.push(e.type) };
  const navigator = { permissions: { query: (d: { name: string }) => Promise.resolve({ name: d.name, get state() { return perm; }, x() { return this.state; } }) } };
  const window: Record<string, unknown> = { Notification: FakeNotification };
  new Function('window', 'navigator', 'document', 'CustomEvent', notificationShim(ask))(window, navigator, document, Event);
  return { N: window.Notification as typeof FakeNotification, navigator, events };
}

describe('ajuste das notificações no mundo da página', () => {
  // Regressão: a função "query" escondia a original e chamava a si mesma (estouro de pilha).
  it('não decidido: "default"/"prompt" até o pedido; depois, o estado real', async () => {
    const { N, navigator } = run(true, 'denied');
    expect(N.permission).toBe('default');
    const st = await navigator.permissions.query({ name: 'notifications' });
    expect(st.state).toBe('prompt');
    expect((st as unknown as { x(): string }).x()).toBe('denied'); // métodos continuam ligados ao objeto real
    expect(await N.requestPermission()).toBe('granted');
    expect(N.permission).toBe('granted');
  });

  it('decidido: não mexe; outras permissões não são afetadas', async () => {
    const { N, navigator } = run(false, 'denied');
    expect(N.permission).toBe('denied');
    expect((await navigator.permissions.query({ name: 'notifications' })).state).toBe('denied');
  });

  it('notificação criada continua sendo Notification e o clique avisa o preload', () => {
    const { N, events } = run(false, 'granted');
    const n = new N('Oi');
    expect(n).toBeInstanceOf(N);
    n.dispatchEvent(new Event('click'));
    expect(events).toEqual(['apollo-notification-click']);
  });
});
