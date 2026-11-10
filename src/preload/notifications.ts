// Notificações no mundo da página (injetado pelo preload, antes dos scripts do site).
//
// 1. Sem decisão salva, o Electron responde "denied" e sites como WhatsApp/Gmail nem
//    chegam a pedir. Aqui, enquanto não decidido, o site enxerga "default"/"prompt";
//    requestPermission() segue o caminho real (a barra do Apollo pergunta).
// 2. Clique numa notificação: avisa o preload (evento no document) para o Apollo mostrar
//    a aba. O preload só aceita com ativação real do usuário (o site não consegue fingir).
export const NOTIFICATION_CLICK_EVENT = 'apollo-notification-click';

export function notificationShim(ask: boolean): string {
  return `(() => {
  const N = window.Notification;
  if (typeof N !== 'function') return;
  let decided = ${ask ? 'false' : 'true'};
  const desc = Object.getOwnPropertyDescriptor(N, 'permission');
  if (!decided && desc && desc.get) {
    Object.defineProperty(N, 'permission', { configurable: true, enumerable: true,
      get() { const real = desc.get.call(N); return !decided && real === 'denied' ? 'default' : real; } });
    const realRequest = N.requestPermission;
    N.requestPermission = function requestPermission(cb) {
      return realRequest.call(N).then((r) => { decided = true; if (typeof cb === 'function') cb(r); return r; });
    };
    const perms = navigator.permissions;
    const realQuery = perms && perms.query;
    if (realQuery) {
      perms.query = function query(d) {
        return realQuery.call(perms, d).then((st) => (!decided && d && d.name === 'notifications' && st.state === 'denied')
          ? new Proxy(st, { get(t, k) { if (k === 'state') return 'prompt'; const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; } })
          : st);
      };
    }
  }
  function Notification(title, options) {
    const n = new N(title, options);
    n.addEventListener('click', () => document.dispatchEvent(new CustomEvent('${NOTIFICATION_CLICK_EVENT}')));
    return n;
  }
  Notification.prototype = N.prototype;
  Object.setPrototypeOf(Notification, N);
  window.Notification = Notification;
})();`;
}
