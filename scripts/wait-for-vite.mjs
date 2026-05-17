import { spawn } from 'node:child_process';

const url = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
const timeoutMs = Number(process.env.WHITEBOARD_DEV_WAIT_MS || 30000);
const startedAt = Date.now();

async function waitForServer() {
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok || response.status < 500) return;
    } catch (_) {
      // Vite is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

await waitForServer();

const child = spawn('electron', ['.'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: url,
  },
});

child.on('exit', code => process.exit(code ?? 0));
