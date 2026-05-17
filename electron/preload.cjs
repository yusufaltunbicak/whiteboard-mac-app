const { contextBridge, ipcRenderer } = require('electron');

function onBoardChanged(callback) {
  const handler = (_event, board) => callback(board);
  ipcRenderer.on('board:changed', handler);
  return () => ipcRenderer.removeListener('board:changed', handler);
}

function onVoiceEvent(channel, callback) {
  const eventName = `voice:${channel}`;
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(eventName, handler);
  return () => ipcRenderer.removeListener(eventName, handler);
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
  voice: {
    getSettings: () => ipcRenderer.invoke('voice:getSettings'),
    updateSettings: (patch) => ipcRenderer.invoke('voice:updateSettings', patch),
    setApiKey: (apiKey) => ipcRenderer.invoke('voice:setApiKey', apiKey),
    hasApiKey: () => ipcRenderer.invoke('voice:hasApiKey'),
    clearApiKey: () => ipcRenderer.invoke('voice:clearApiKey'),
    createRealtimeCall: (localSdp) => ipcRenderer.invoke('voice:createRealtimeCall', localSdp),
    endRealtimeSession: () => ipcRenderer.invoke('voice:endRealtimeSession'),
    classifyRequest: (input) => ipcRenderer.invoke('voice:classifyRequest', input),
    getRuntimeContext: () => ipcRenderer.invoke('voice:getRuntimeContext'),
    executeBoardActions: (actions, metadata) => ipcRenderer.invoke('voice:executeBoardActions', actions, metadata),
    undoLastAction: () => ipcRenderer.invoke('voice:undoLastAction'),
    searchContext: (query, options) => ipcRenderer.invoke('voice:searchContext', query, options),
    readContextFile: (input) => ipcRenderer.invoke('voice:readContextFile', input),
    proposeTaskDraft: (input) => ipcRenderer.invoke('voice:proposeTaskDraft', input),
    listTaskDrafts: () => ipcRenderer.invoke('voice:listTaskDrafts'),
    updateTaskDraft: (input) => ipcRenderer.invoke('voice:updateTaskDraft', input),
    discardTaskDraft: (input) => ipcRenderer.invoke('voice:discardTaskDraft', input),
    applyTaskDraft: (input) => ipcRenderer.invoke('voice:applyTaskDraft', input),
    requestFolderAccess: (reason) => ipcRenderer.invoke('voice:requestFolderAccess', reason),
    readAssistantDocs: () => ipcRenderer.invoke('voice:readAssistantDocs'),
    proposeMemoryEntry: (proposal) => ipcRenderer.invoke('voice:proposeMemoryEntry', proposal),
    applyMemoryEntry: (input) => ipcRenderer.invoke('voice:applyMemoryEntry', input),
    updateSessionSummary: (input) => ipcRenderer.invoke('voice:updateSessionSummary', input),
    onShortcut: (callback) => onVoiceEvent('shortcut', callback),
    onOpenSettings: (callback) => onVoiceEvent('open-settings', callback),
    onSettingsChanged: (callback) => onVoiceEvent('settings-changed', callback),
    onMemoryProposed: (callback) => onVoiceEvent('memory-proposed', callback),
    onMemoryApplied: (callback) => onVoiceEvent('memory-applied', callback),
    onDraftsChanged: (callback) => onVoiceEvent('drafts-changed', callback),
    onSessionSummaryChanged: (callback) => onVoiceEvent('session-summary-changed', callback),
  },
});
