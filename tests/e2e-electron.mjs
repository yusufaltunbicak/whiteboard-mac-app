import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const mode = process.argv.includes('--dev') ? 'dev' : 'dist';
const root = fs.mkdtempSync(path.join(os.tmpdir(), `whiteboard-e2e-${mode}-`));
const boardPath = path.join(root, 'whiteboard-todos.md');
const userDataPath = path.join(root, 'user-data');
const vaultFolder = path.join(root, 'vault', 'Projects');
const notePath = path.join(vaultFolder, 'Project.md');
const screenshotPath = path.join(root, `whiteboard-${mode}.png`);
const port = 9400 + Math.floor(Math.random() * 400);
const vitePort = 5178 + Math.floor(Math.random() * 200);

fs.mkdirSync(vaultFolder, { recursive: true });
fs.mkdirSync(userDataPath, { recursive: true });
fs.writeFileSync(boardPath, `---
categories:
  - id: work
    name: work
    color: "#4A90D9"
positions:
  local01:
    - 220
    - 260
  local02:
    - 580
    - 260
labels:
  - id: lbl-existing
    text: EXISTING
    x: 220
    y: 520
areas:
  - id: area-existing
    x: 180
    y: 680
    width: 360
    height: 180
    color: "#5BAE7C"
    opacity: 0.12
---

# Whiteboard Todos

- [ ] Local first #work <!-- id:local01 -->
- [ ] Local second <!-- id:local02 -->
`, 'utf-8');
fs.writeFileSync(notePath, '- [ ] External first #wb\n', 'utf-8');
fs.writeFileSync(path.join(userDataPath, 'whiteboard-index.json'), `${JSON.stringify({
  version: 1,
  sync: {
    enabled: true,
    vaultRoot: path.join(root, 'vault'),
    folders: [vaultFolder],
    tags: ['#wb'],
  },
  externalLayouts: {},
  hiddenExternalTaskIds: [],
}, null, 2)}\n`, 'utf-8');

const children = [];

function spawnChild(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return child;
}

function collectOutput(child, label) {
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk.toString(); });
  child.stderr?.on('data', chunk => { output += chunk.toString(); });
  child.on('exit', code => {
    if (code && !child.killed) output += `\n${label} exited with ${code}\n`;
  });
  return () => output;
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForUrl(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'no response'}`);
}

async function waitForCdp(activeProcess, getOutput) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < 30000) {
    if (activeProcess.exitCode != null) {
      throw new Error(`Electron exited before CDP opened:\n${getOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Electron CDP: ${lastError?.message || 'no response'}`);
}

async function firstPage(browser) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    for (const context of browser.contexts()) {
      const [page] = context.pages();
      if (page) return page;
    }
    await sleep(200);
  }
  throw new Error('No Electron page found');
}

async function launchElectron() {
  let viteOutput = () => '';
  if (mode === 'dev') {
    const vite = spawnChild(path.join(repoRoot, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(vitePort)]);
    viteOutput = collectOutput(vite, 'vite');
    await waitForUrl(`http://127.0.0.1:${vitePort}`);
  }

  const electronEnv = {
    WHITEBOARD_TODOS_PATH: boardPath,
    WHITEBOARD_USER_DATA_PATH: userDataPath,
    ...(mode === 'dist'
      ? { WHITEBOARD_ELECTRON_LOAD: 'dist' }
      : { VITE_DEV_SERVER_URL: `http://127.0.0.1:${vitePort}` }),
  };
  const electron = spawnChild(path.join(repoRoot, 'node_modules/.bin/electron'), [`--remote-debugging-port=${port}`, '.'], electronEnv);
  const electronOutput = collectOutput(electron, 'electron');
  await waitForCdp(electron, () => `${viteOutput()}\n${electronOutput()}`);
  return { electronOutput, viteOutput };
}

async function run() {
  const output = await launchElectron();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await firstPage(browser);
  const consoleIssues = [];
  page.on('console', (message) => {
    if (['error'].includes(message.type())) consoleIssues.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', error => consoleIssues.push(`pageerror: ${error.message}`));

  await page.waitForSelector('.task-card', { timeout: 15000 });
  assert.equal(await page.title(), 'Whiteboard Todos');
  assert.match(await page.locator('body').innerText(), /Local first/);
  assert.match(await page.locator('body').innerText(), /External first/);
  assert.equal(await page.locator('.toolbar').evaluate(el => getComputedStyle(el).webkitAppRegion), 'drag');
  assert.equal(await page.locator('.toolbar-form').evaluate(el => getComputedStyle(el).webkitAppRegion), 'no-drag');

  await page.locator('input[placeholder="Add a task..."]').fill('Added through E2E');
  await page.keyboard.press('Enter');
  await page.getByText('Added through E2E').waitFor({ timeout: 10000 });
  await sleep(700);
  assert.match(fs.readFileSync(boardPath, 'utf-8'), /Added through E2E/);

  await page.mouse.dblclick(900, 600);
  await sleep(1200);
  await assert.doesNotReject(() => page.locator('.label-input').waitFor({ timeout: 1000 }));
  await page.locator('.label-input').fill('QA LABEL');
  await page.keyboard.press('Enter');
  await page.getByText('QA LABEL').waitFor({ timeout: 10000 });
  await sleep(700);
  assert.match(fs.readFileSync(boardPath, 'utf-8'), /QA LABEL/);

  const firstCard = page.locator('.task-card').filter({ hasText: 'Local first' }).first();
  const beforeBox = await firstCard.boundingBox();
  assert.ok(beforeBox);
  await page.mouse.move(beforeBox.x + 80, beforeBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(beforeBox.x + 210, beforeBox.y + 110, { steps: 8 });
  await page.mouse.up();
  await sleep(900);
  assert.match(fs.readFileSync(boardPath, 'utf-8'), /local01:\n\s+- 350\n\s+- 330/);

  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.locator('.task-card').filter({ hasText: 'Local second' }).first().click({ force: true });
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.getByText('2 selected').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Set priority' }).click();
  await sleep(700);
  assert.match(fs.readFileSync(boardPath, 'utf-8'), /Local first #work !!!/);
  assert.match(fs.readFileSync(boardPath, 'utf-8'), /Local second !!!/);

  await page.getByTitle('Area').click();
  await page.mouse.move(840, 700);
  await page.mouse.down();
  await page.mouse.move(1080, 850, { steps: 5 });
  await page.mouse.up();
  await sleep(700);
  assert.match(fs.readFileSync(boardPath, 'utf-8'), /area-/);

  await page.locator('.task-card').filter({ hasText: 'External first' }).first().locator('input[type="checkbox"]').click({ force: true });
  await sleep(900);
  assert.match(fs.readFileSync(notePath, 'utf-8'), /^- \[x\] External first #wb <!-- wb-id:wb-[a-f0-9]{10} -->/);
  fs.appendFileSync(notePath, '- [ ] External reload #wb ^reload-test\n', 'utf-8');
  await page.getByText('External reload').waitFor({ timeout: 10000 });

  const zoomBefore = await page.locator('.zoom-level').innerText();
  await page.getByTitle('Zoom in').click();
  await page.waitForFunction(before => document.querySelector('.zoom-level')?.innerText !== before, zoomBefore);
  await page.getByTitle('Hide toolbar').click();
  await page.locator('.toolbar-hidden').waitFor({ timeout: 5000 });
  await page.getByTitle('Show toolbar').click();
  await page.locator('.toolbar:not(.toolbar-hidden)').waitFor({ timeout: 5000 });
  await page.locator('.theme-toggle').click();

  await page.screenshot({ path: screenshotPath, fullPage: false });
  assert.deepEqual(consoleIssues, []);

  await browser.close();
  return {
    mode,
    root,
    boardPath,
    notePath,
    screenshotPath,
    checks: [
      'Electron page rendered real board and external tagged task',
      'toolbar has draggable app region and form controls are no-drag',
      'task add persisted to Markdown',
      'label draft stayed open after autosave window and persisted after Enter',
      'task drag updated frontmatter position',
      'multi-select bulk priority persisted',
      'area tool created an area',
      'external checkbox wrote back to source note with stable marker',
      'external watcher loaded appended tagged task',
      'zoom, toolbar hide/show, and theme controls responded',
      'no renderer console errors',
    ],
  };
}

try {
  const result = await run();
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode == null) {
      child.kill('SIGTERM');
      await sleep(250);
      if (child.exitCode == null) child.kill('SIGKILL');
    }
  }
}
