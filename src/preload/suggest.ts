// Ponte da lista de sugestões da barra de endereço: recebe os itens e avisa o clique.
// Nada de Node, nada de ipcRenderer cru.
import { contextBridge, ipcRenderer } from 'electron';

interface Data { items: { kind: string; url: string; title: string }[]; selected: number }

contextBridge.exposeInMainWorld('suggest', {
  onItems: (cb: (data: Data) => void): void => { ipcRenderer.on('suggest:items', (_e, d: Data) => cb(d)); },
  onSelect: (cb: (index: number) => void): void => { ipcRenderer.on('suggest:select', (_e, i: number) => cb(i)); },
  pick: (index: number): void => ipcRenderer.send('suggest:pick', index),
});
