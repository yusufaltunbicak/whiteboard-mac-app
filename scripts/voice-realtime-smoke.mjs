import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { app, BrowserWindow, safeStorage } from 'electron';
import { createVoiceStore } from '../electron/voiceStore.js';

const userDataPath = path.join(os.homedir(), 'Library/Application Support/Whiteboard Todos');
const debug = process.env.VOICE_SMOKE_DEBUG === '1';

app.setName('Whiteboard Todos');
app.setPath('userData', userDataPath);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.on('window-all-closed', (event) => event.preventDefault());

function createBoardStore() {
  return {
    boardPath: path.join(userDataPath, 'whiteboard.md'),
    state: {
      sync: {
        enabled: false,
        folders: [],
      },
    },
    readBoard() {
      return { tasks: [], labels: [], categories: [], areas: [] };
    },
    writeBoard(board) {
      return { ok: true, board, warnings: [] };
    },
  };
}

function withTimeout(promise, timeoutMs, stage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${stage} timed out after ${timeoutMs}ms`)), timeoutMs);
  return Promise
    .resolve(promise(controller.signal))
    .finally(() => clearTimeout(timer));
}

function rejectAfter(timeoutMs, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), timeoutMs);
  });
}

async function testClientSecrets(store, model) {
  const apiKey = await store.getApiKey();
  return withTimeout(async (signal) => {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model,
          audio: {
            output: {
              voice: store.settings.voice,
            },
          },
        },
      }),
    });
    const text = await response.text();
    return {
      stage: 'client_secrets',
      model,
      ok: response.ok,
      status: response.status,
      body: response.ok ? '[redacted token response]' : text.slice(0, 500),
    };
  }, 15000, `client_secrets:${model}`);
}

async function createOfferSdp() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  try {
    await win.loadURL(process.env.VOICE_SMOKE_PAGE_URL || 'data:text/html,<html><body></body></html>');
    const offerScript = `(async () => {
      const pc = new RTCPeerConnection();
      pc.createDataChannel('oai-events');
      if (!${JSON.stringify(process.env.VOICE_SMOKE_DATA_ONLY === '1')}) {
        if (navigator.mediaDevices?.getUserMedia) {
          const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
          pc.addTrack(ms.getAudioTracks()[0], ms);
        } else {
          pc.addTransceiver('audio', { direction: 'sendrecv' });
        }
      }
      const timeout = (label, ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timed out')), ms));
      const offer = await Promise.race([pc.createOffer(), timeout('createOffer', 5000)]);
      await pc.setLocalDescription(offer);
      await Promise.race([new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
          return;
        }
        const timer = setTimeout(resolve, 2000);
        pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timer);
            resolve();
          }
        });
      }), timeout('iceGathering', 5000)]);
      const sdp = pc.localDescription.sdp;
      pc.close();
      return sdp;
    })()`;
    return await Promise.race([
      win.webContents.executeJavaScript(offerScript),
      rejectAfter(7000, 'Timed out while creating WebRTC offer in Electron renderer.'),
    ]);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function testRendererProbe() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  try {
    await win.loadURL('data:text/html,<html><body>probe</body></html>');
    const result = await win.webContents.executeJavaScript(`({
      readyState: document.readyState,
      rtc: typeof RTCPeerConnection,
      mediaDevices: typeof navigator.mediaDevices,
      sum: 1 + 1,
    })`);
    return {
      stage: 'renderer_probe',
      ok: true,
      result,
    };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function testRealtimeCall(store) {
  if (debug) console.error('voice-smoke: creating WebRTC offer');
  const sdp = await createOfferSdp();
  if (debug) console.error(`voice-smoke: offer length ${sdp.length}; candidates=${sdp.includes('a=candidate:')}`);
  if (debug) console.error('voice-smoke: creating Realtime call');

  if (process.env.VOICE_SMOKE_MINIMAL_SESSION === '1') {
    const apiKey = await store.getApiKey();
    const fd = new FormData();
    fd.set('sdp', sdp);
    fd.set('session', JSON.stringify({
      type: 'realtime',
      model: store.settings.model,
      audio: { output: { voice: store.settings.voice } },
    }));
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
    const text = await response.text();
    return {
      stage: 'realtime_call_minimal',
      ok: response.ok,
      status: response.status,
      body: response.ok ? `[answer length ${text.length}]` : text.slice(0, 500),
    };
  }

  const result = await store.createRealtimeCall(sdp);
  if (debug) console.error(`voice-smoke: answer length ${String(result.sdp || '').length}`);
  return {
    stage: 'realtime_call',
    ok: true,
    model: result.model,
    voice: result.voice,
    answerLength: String(result.sdp || '').length,
    answerPrefix: String(result.sdp || '').slice(0, 10),
  };
}

async function testKeyShape(store) {
  const apiKey = await store.getApiKey();
  return {
    stage: 'key',
    ok: true,
    length: apiKey.length,
    prefix: apiKey.slice(0, 8),
  };
}

async function testDecryptDiagnostic() {
  const payloadPath = path.join(userDataPath, 'openai-api-key.json');
  const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf-8'));
  const encrypted = Buffer.from(payload.value, 'base64');
  const decrypted = typeof safeStorage.decryptStringAsync === 'function'
    ? await safeStorage.decryptStringAsync(encrypted)
    : safeStorage.decryptString(encrypted);
  const asString = typeof decrypted === 'string'
    ? decrypted
    : Buffer.isBuffer(decrypted)
      ? decrypted.toString('utf-8')
      : ArrayBuffer.isView(decrypted)
        ? Buffer.from(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength).toString('utf-8')
        : String(decrypted || '');

  return {
    stage: 'decrypt-diagnostic',
    ok: true,
    rawType: typeof decrypted,
    rawTag: Object.prototype.toString.call(decrypted),
    rawKeys: decrypted && typeof decrypted === 'object' ? Object.keys(decrypted) : [],
    rawEntries: decrypted && typeof decrypted === 'object'
      ? Object.fromEntries(Object.entries(decrypted).map(([key, value]) => [key, {
        type: typeof value,
        tag: Object.prototype.toString.call(value),
        isBuffer: Buffer.isBuffer(value),
        isArrayBufferView: ArrayBuffer.isView(value),
        length: value?.length ?? value?.byteLength ?? null,
      }]))
      : {},
    isBuffer: Buffer.isBuffer(decrypted),
    isArrayBufferView: ArrayBuffer.isView(decrypted),
    rawLength: decrypted?.length ?? decrypted?.byteLength ?? null,
    stringLength: asString.length,
    startsWithSk: asString.trim().startsWith('sk-'),
    firstCharCodes: Array.from(asString.slice(0, 12)).map(char => char.charCodeAt(0)),
  };
}

async function main() {
  await app.whenReady();

  const store = createVoiceStore({
    userDataPath,
    boardStore: createBoardStore(),
    getWindow: () => null,
  });

  const settingsPath = path.join(userDataPath, 'voice-settings.json');
  const settings = fs.existsSync(settingsPath)
    ? JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    : {};
  if (settings.model) store.settings.model = settings.model;
  if (settings.voice) store.settings.voice = settings.voice;

  const mode = process.argv[2] || 'client-secrets';
  if (mode === 'decrypt-diagnostic') {
    console.log(JSON.stringify(await testDecryptDiagnostic(), null, 2));
    return;
  }

  if (mode === 'key') {
    console.log(JSON.stringify(await testKeyShape(store)));
    return;
  }

  if (mode === 'probe') {
    console.log(JSON.stringify(await testRendererProbe(), null, 2));
    return;
  }

  if (mode === 'call') {
    console.log(JSON.stringify(await testRealtimeCall(store), null, 2));
    return;
  }

  const models = [...new Set([store.settings.model, 'gpt-realtime'].filter(Boolean))];
  const results = [];
  for (const model of models) {
    try {
      results.push(await testClientSecrets(store, model));
    } catch (error) {
      results.push({
        stage: 'client_secrets',
        model,
        ok: false,
        error: error?.message || String(error),
      });
    }
  }
  console.log(JSON.stringify({ ok: results.some(result => result.ok), results }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error?.message || String(error),
    }));
    process.exitCode = 1;
  })
  .finally(() => app.quit());
