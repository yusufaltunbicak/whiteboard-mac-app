const { contextBridge, ipcRenderer } = require('electron');

function onBoardChanged(callback) {
  const handler = (_event, board) => callback(board);
  ipcRenderer.on('board:changed', handler);
  return () => ipcRenderer.removeListener('board:changed', handler);
}

contextBridge.exposeInMainWorld('whiteboard', {
  getBoard: () => ipcRenderer.invoke('board:get'),
  saveBoard: (board) => ipcRenderer.invoke('board:save', board),
  onBoardChanged,
  getSyncSettings: () => ipcRenderer.invoke('sync:get'),
  updateSyncSettings: (patch) => ipcRenderer.invoke('sync:update', patch),
  chooseSyncFolders: () => ipcRenderer.invoke('sync:chooseFolders'),
  refreshSync: () => ipcRenderer.invoke('sync:refresh'),
  getAppMeta: () => ipcRenderer.invoke('app:meta'),
});
