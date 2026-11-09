// Preload das ABAS (sites). Roda isolado da página (contextIsolation) e não expõe
// nada a ela: só pede ao processo principal os filtros cosméticos e scriptlets.
import { ipcRenderer, webFrame } from 'electron';
import { DOMMonitor } from '@ghostery/adblocker-content';

/**
 * Um único script com todos os scriptlets, como o uBlock faz: as funções nativas
 * (JSON.parse, fetch…) são capturadas uma vez, antes de qualquer scriptlet
 * interceptá-las. Injetados separados, dois json-prune se encadeavam e o player
 * do YouTube não carregava. Cada um isolado num try para um erro não parar os outros.
 */
export function combineScriptlets(scripts: string[]): string {
  return scripts.map((s) => `try {\n${s}\n} catch (e) {}`).join('\n');
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
