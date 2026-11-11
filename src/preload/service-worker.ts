// Preload dos service workers dos sites. Só observa: quando o usuário clica numa
// notificação mostrada pelo service worker (WhatsApp, Teams…), avisa o Apollo para mostrar
// a aba/painel do site. Só cliques de verdade (isTrusted): o site não consegue fingir.
//
// O preload roda num contexto isolado, sem o escopo do service worker: o ouvinte é instalado
// no contexto do worker por executeInMainWorld, e o aviso volta por uma função passada como
// argumento — fica presa no fechamento, o código do site não a enxerga.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.executeInMainWorld({
  func: (notify: () => void) => {
    (self as unknown as { addEventListener(t: string, f: (e: Event) => void): void })
      .addEventListener('notificationclick', (e) => { if (e.isTrusted) notify(); });
  },
  args: [() => ipcRenderer.send('apollo:sw-notification-click')],
});
// Diagnóstico (testes de integração): confirma que o preload carregou neste service worker.
ipcRenderer.send('apollo:sw-preload-loaded');
