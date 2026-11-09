// Ponte da UI (sandbox) com o processo principal. Só expõe: enviar comando,
// receber estado e receber eventos. Nada de Node, nada de ipcRenderer cru.
import { contextBridge, ipcRenderer } from 'electron';
import type { UiCommand, UiEvent, UiState } from '../shared/types';

const api = {
  send: (cmd: UiCommand): void => ipcRenderer.send('ui:command', cmd),
  onState: (cb: (state: UiState) => void): void => {
    ipcRenderer.on('ui:state', (_e, state: UiState) => cb(state));
  },
  onEvent: (cb: (event: UiEvent) => void): void => {
    ipcRenderer.on('ui:event', (_e, event: UiEvent) => cb(event));
  },
};

export type ApolloApi = typeof api;

contextBridge.exposeInMainWorld('apollo', api);
