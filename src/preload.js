const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apollo', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  clearWorkspaceData: (partition) => ipcRenderer.invoke('workspace:clear-data', partition),
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_e, action) => cb(action)),
  onOpenTab: (cb) => ipcRenderer.on('open-tab', (_e, payload) => cb(payload)),
});
