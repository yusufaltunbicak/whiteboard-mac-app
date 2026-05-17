const hasElectronApi = () => typeof window !== 'undefined' && Boolean(window.whiteboard);

export function isElectronRuntime() {
  return hasElectronApi();
}

export async function getBoard() {
  if (hasElectronApi()) return window.whiteboard.getBoard();
  const response = await fetch('/api/board');
  if (!response.ok) throw new Error(`Board load failed: ${response.status}`);
  return response.json();
}

export async function saveBoard(board, options = {}) {
  if (hasElectronApi()) return window.whiteboard.saveBoard(board);

  const body = JSON.stringify(board);
  if (options.tryBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const ok = navigator.sendBeacon('/api/board', new Blob([body], { type: 'application/json' }));
    if (ok) return { ok: true };
  }

  const response = await fetch('/api/board', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    ...(options.keepalive ? { keepalive: true } : {}),
  });
  if (!response.ok) throw new Error(`Save failed: ${response.status}`);
  return response.json();
}

export function onBoardChanged(callback) {
  if (hasElectronApi()) return window.whiteboard.onBoardChanged(callback);

  const eventSource = new EventSource('/api/events');
  eventSource.onmessage = (event) => {
    callback(JSON.parse(event.data));
  };
  return () => eventSource.close();
}

export async function chooseSyncFolders() {
  if (!hasElectronApi()) return null;
  return window.whiteboard.chooseSyncFolders();
}

export async function refreshSync() {
  if (!hasElectronApi()) return null;
  return window.whiteboard.refreshSync();
}
