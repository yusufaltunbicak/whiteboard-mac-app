import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import electronUpdater from 'electron-updater';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoardStore } from './boardStore.js';
import { createVoiceStore } from './voiceStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDevServer = process.env.WHITEBOARD_ELECTRON_LOAD !== 'dist' && !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
const { autoUpdater } = electronUpdater;

let mainWindow = null;
let store = null;
let voiceStore = null;

function getAppDisplayName() {
  return process.env.WHITEBOARD_PRODUCT_NAME || app.getName() || 'Whiteboard Todos';
}

function getReleaseChannel() {
  if (process.env.WHITEBOARD_RELEASE_CHANNEL) return process.env.WHITEBOARD_RELEASE_CHANNEL;
  return getAppDisplayName().toLowerCase().includes('beta') ? 'beta' : 'latest';
}

function isBetaApp() {
  return getReleaseChannel() === 'beta' || getAppDisplayName().toLowerCase().includes('beta');
}

function getDefaultUserDataPath() {
  const folderName = isBetaApp() ? 'Whiteboard Todos Beta' : 'Whiteboard Todos';
  return path.join(os.homedir(), 'Library', 'Application Support', folderName);
}

function getBoardPathOverride() {
  if (process.env.WHITEBOARD_TODOS_PATH) return process.env.WHITEBOARD_TODOS_PATH;
  if (!isBetaApp()) return undefined;
  return path.join(os.homedir(), 'Documents', 'Second brain', 'whiteboard-todos-beta.md');
}

function configureAppIdentity() {
  app.setName(getAppDisplayName());
  app.setPath('userData', process.env.WHITEBOARD_USER_DATA_PATH || getDefaultUserDataPath());
}

function updatesAreDisabled() {
  return process.env.WHITEBOARD_DISABLE_AUTO_UPDATE === '1'
    || process.env.WHITEBOARD_DISABLE_AUTO_UPDATE === 'true';
}

function sendBoardChanged(board) {
  const target = mainWindow?.webContents;
  if (target && !target.isDestroyed()) {
    target.send('board:changed', board);
  }
}

async function chooseSyncFolders() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select folders to scan for #whiteboard or #wb todos',
    defaultPath: store.state.sync.vaultRoot,
    properties: ['openDirectory', 'multiSelections'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return store.readBoard();
  }

  return store.updateSyncSettings({
    enabled: true,
    folders: result.filePaths,
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Show Board File',
          click: () => shell.showItemInFolder(store.boardPath),
        },
        {
          label: 'Show Sync Index',
          click: () => shell.showItemInFolder(store.statePath),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Sync',
      submenu: [
        {
          label: 'Enable Vault Sync / Select Folders...',
          click: async () => sendBoardChanged(await chooseSyncFolders()),
        },
        {
          label: 'Refresh Sync',
          accelerator: 'CmdOrCtrl+R',
          click: () => sendBoardChanged(store.readBoard()),
        },
        {
          label: 'Show Hidden External Todos Again',
          click: () => sendBoardChanged(store.clearHiddenExternalTasks()),
        },
        { type: 'separator' },
        {
          label: 'Disable Vault Sync',
          click: () => sendBoardChanged(store.updateSyncSettings({ enabled: false })),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Voice',
      submenu: voiceStore?.buildMenuItems() || [
        { label: 'Voice unavailable', enabled: false },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const displayName = getAppDisplayName();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    title: displayName,
    show: false,
    backgroundColor: '#FBFBFB',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDevServer) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
}

function registerIpc() {
  ipcMain.handle('board:get', () => store.readBoard());
  ipcMain.handle('board:save', (_event, board) => store.writeBoard(board));
  ipcMain.handle('sync:get', () => store.getSyncInfo(store.scanExternalTasks().length));
  ipcMain.handle('sync:update', (_event, patch) => store.updateSyncSettings(patch));
  ipcMain.handle('sync:chooseFolders', () => chooseSyncFolders());
  ipcMain.handle('sync:refresh', () => store.readBoard());
  ipcMain.handle('app:meta', () => ({
    version: app.getVersion(),
    name: getAppDisplayName(),
    channel: getReleaseChannel(),
    beta: isBetaApp(),
    boardPath: store.boardPath,
    userDataPath: app.getPath('userData'),
    packaged: app.isPackaged,
  }));
  ipcMain.handle('voice:getSettings', () => voiceStore.getSettings());
  ipcMain.handle('voice:updateSettings', (_event, patch) => {
    const result = voiceStore.updateSettings(patch);
    buildMenu();
    return result;
  });
  ipcMain.handle('voice:setApiKey', (_event, apiKey) => voiceStore.setApiKey(apiKey));
  ipcMain.handle('voice:hasApiKey', () => voiceStore.hasApiKey());
  ipcMain.handle('voice:clearApiKey', () => voiceStore.clearApiKey());
  ipcMain.handle('voice:createRealtimeCall', (_event, localSdp) => voiceStore.createRealtimeCall(localSdp));
  ipcMain.handle('voice:endRealtimeSession', () => voiceStore.endRealtimeSession());
  ipcMain.handle('voice:classifyRequest', (_event, input) => voiceStore.classifyRequest(input));
  ipcMain.handle('voice:getRuntimeContext', () => voiceStore.getRuntimeContext());
  ipcMain.handle('voice:executeBoardActions', (_event, actions, metadata) => voiceStore.executeBoardActions(actions, metadata));
  ipcMain.handle('voice:undoLastAction', () => voiceStore.undoLastAction());
  ipcMain.handle('voice:searchContext', (_event, query, options) => voiceStore.searchContext(query, options));
  ipcMain.handle('voice:readContextFile', (_event, input) => voiceStore.readContextFile(input));
  ipcMain.handle('voice:proposeTaskDraft', (_event, input) => voiceStore.proposeTaskDraft(input));
  ipcMain.handle('voice:listTaskDrafts', () => voiceStore.listTaskDrafts());
  ipcMain.handle('voice:updateTaskDraft', (_event, input) => voiceStore.updateTaskDraft(input));
  ipcMain.handle('voice:discardTaskDraft', (_event, input) => voiceStore.discardTaskDraft(input));
  ipcMain.handle('voice:applyTaskDraft', (_event, input) => voiceStore.applyTaskDraft(input));
  ipcMain.handle('voice:requestFolderAccess', (_event, reason) => voiceStore.requestFolderAccess(reason));
  ipcMain.handle('voice:readAssistantDocs', () => voiceStore.readAssistantDocs());
  ipcMain.handle('voice:proposeMemoryEntry', (_event, proposal) => voiceStore.proposeMemoryEntry(proposal));
  ipcMain.handle('voice:applyMemoryEntry', (_event, input) => voiceStore.applyMemoryEntry(input));
  ipcMain.handle('voice:updateSessionSummary', (_event, input) => voiceStore.updateSessionSummary(input));
}

function configureAutoUpdates() {
  if (!app.isPackaged || updatesAreDisabled()) return;

  autoUpdater.autoDownload = false;
  autoUpdater.channel = getReleaseChannel();
  autoUpdater.allowPrerelease = isBetaApp();
  autoUpdater.allowDowngrade = isBetaApp();

  autoUpdater.on('error', error => {
    console.warn('Auto-update check failed:', error?.message || error);
  });

  autoUpdater.on('update-available', async info => {
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Available',
      message: `${getAppDisplayName()} ${info.version} is available.`,
      detail: 'The update will be downloaded in the background.',
    });

    if (response.response === 0) {
      autoUpdater.downloadUpdate().catch(error => {
        console.warn('Auto-update download failed:', error?.message || error);
      });
    }
  });

  autoUpdater.on('update-downloaded', async info => {
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Ready',
      message: `${getAppDisplayName()} ${info.version} is ready to install.`,
      detail: 'Restart the app to finish installing the update.',
    });

    if (response.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(error => {
      console.warn('Auto-update check failed:', error?.message || error);
    });
  }, 3000);
}

app.whenReady().then(async () => {
  configureAppIdentity();
  store = createBoardStore({
    userDataPath: app.getPath('userData'),
    boardPath: getBoardPathOverride(),
  });
  voiceStore = createVoiceStore({
    userDataPath: app.getPath('userData'),
    boardStore: store,
    getWindow: () => mainWindow,
  });
  store.restartWatchers();
  store.on('changed', sendBoardChanged);
  voiceStore.initialize();
  registerIpc();
  buildMenu();
  await createWindow();
  configureAutoUpdates();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('before-quit', () => {
  voiceStore?.close();
  store?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
