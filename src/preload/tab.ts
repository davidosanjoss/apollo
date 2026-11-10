// Preload das ABAS (sites). Roda isolado da página (contextIsolation) e não expõe
// nada a ela: só pede ao processo principal os filtros cosméticos e scriptlets.
import { ipcRenderer, webFrame } from 'electron';
import { DOMMonitor } from '@ghostery/adblocker-content';
import { fillLogin, fillNewPassword } from './fill';
import { watchLogins } from './capture';
import { NOTIFICATION_CLICK_EVENT, notificationShim } from './notifications';
import { PAGE_FIRST, shortcutFor } from '../main/shortcuts';

// Atalhos que a página recebe primeiro (Ctrl+R, Ctrl+F, Ctrl+K…): se ela não usou a tecla,
// o Apollo age. Ouvimos depois dela (bolha no window) e só teclas de verdade (isTrusted):
// um site não consegue mandar o Apollo recarregar ou imprimir sozinho.
if (window === window.top) {
  window.addEventListener('keydown', (e) => {
    if (!e.isTrusted || e.defaultPrevented) return;
    const input = { type: 'keyDown', key: e.key, control: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey };
    const action = shortcutFor(input);
    if (action && PAGE_FIRST.has(action)) {
      e.preventDefault();
      ipcRenderer.send('apollo:page-shortcut', input);
    }
  });
}

// Preenchimento do Bitwarden: só o processo principal envia (mainFrame.send), e só
// depois de conferir que a URL desta página casa com o login.
if (window === window.top) {
  ipcRenderer.on('apollo:fill', (_e, data: { username: string | null; password: string | null }) => {
    fillLogin(document, data?.username ?? null, data?.password ?? null);
  });
  ipcRenderer.on('apollo:fill-new-password', (_e, password: string) => {
    if (typeof password === 'string') fillNewPassword(document, password);
  });
  // Oferecer salvar no Bitwarden: avisa o main quando um login é enviado.
  if (/^https?:/.test(location.href)) {
    watchLogins(document,
      (c) => ipcRenderer.send('apollo:login-submitted', c),
      (u) => ipcRenderer.send('apollo:username-step', u));
  }
}

/**
 * Um único script com todos os scriptlets, como o uBlock faz: as funções nativas
 * (JSON.parse, fetch…) são capturadas uma vez, antes de qualquer scriptlet
 * interceptá-las. Injetados separados, dois json-prune se encadeavam e o player
 * do YouTube não carregava. Cada um isolado num try para um erro não parar os outros.
 */
export function combineScriptlets(scripts: string[]): string {
  return scripts.map((s) => `try {\n${s}\n} catch (e) {}`).join('\n');
}

if (window === window.top && /^https?:/.test(location.href) && typeof Notification === 'function') {
  const state = ipcRenderer.sendSync('apollo:notification-state') as 'ask' | 'allow' | 'deny' | null;
  if (state) void webFrame.executeJavaScript(notificationShim(state === 'ask')).catch(() => {});
  // Só um clique de verdade (ativação do usuário) leva o Apollo para esta aba.
  document.addEventListener(NOTIFICATION_CLICK_EVENT, () => {
    if (navigator.userActivation?.isActive) ipcRenderer.send('apollo:notification-click');
  });
}

if (window === window.top && /^https?:/.test(location.href)) {
  // Síncrono de propósito: scriptlets (ex.: anúncios do YouTube) precisam rodar
  // ANTES dos scripts da página. Trava só esta aba por alguns ms.
  const start = ipcRenderer.sendSync('apollo:cosmetics-start') as { scripts: string[] } | null;
  const scripts = start?.scripts ?? [];
  if (scripts.length) void webFrame.executeJavaScript(combineScriptlets(scripts)).catch(() => {});

  if (start) {
    window.addEventListener('DOMContentLoaded', () => {
      const monitor = new DOMMonitor((update) => {
        if (update.type === 'features') {
          void ipcRenderer.invoke('apollo:cosmetics-dom', { classes: update.classes, ids: update.ids, hrefs: update.hrefs });
        }
      });
      monitor.queryAll(window);
      monitor.start(window);
      window.addEventListener('pagehide', () => monitor.stop(), { once: true });
    }, { once: true });
  }
}
