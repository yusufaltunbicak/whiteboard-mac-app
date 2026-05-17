import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chokidar from 'chokidar';
import {
  DEFAULT_SYNC_TAGS,
  createDefaultBoardMarkdown,
  normalizeSyncTags,
  parseBoardMarkdown,
  parseExternalTaskLine,
  serializeBoardMarkdown,
  stableHash,
  updateExternalCheckboxLine,
} from './markdown.js';

const BOARD_PATH = process.env.WHITEBOARD_TODOS_PATH
  || path.join(os.homedir(), 'Documents', 'Second brain', 'whiteboard-todos.md');

const DEFAULT_VAULT_ROOT = path.join(os.homedir(), 'Documents', 'Second brain');
const WATCH_DEBOUNCE_MS = 120;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function defaultState() {
  return {
    version: 1,
    sync: {
      enabled: false,
      vaultRoot: DEFAULT_VAULT_ROOT,
      folders: [],
      tags: DEFAULT_SYNC_TAGS,
    },
    externalLayouts: {},
    hiddenExternalTaskIds: [],
  };
}

function sanitizeState(raw) {
  const base = defaultState();
  const sync = { ...base.sync, ...(raw?.sync || {}) };
  return {
    ...base,
    ...(raw || {}),
    sync: {
      ...sync,
      tags: normalizeSyncTags(sync.tags),
      folders: Array.isArray(sync.folders) ? sync.folders.filter(Boolean) : [],
      enabled: Boolean(sync.enabled),
    },
    externalLayouts: raw?.externalLayouts && typeof raw.externalLayouts === 'object' ? raw.externalLayouts : {},
    hiddenExternalTaskIds: Array.isArray(raw?.hiddenExternalTaskIds) ? raw.hiddenExternalTaskIds : [],
  };
}

function safeRelative(root, filePath) {
  try {
    return path.relative(root, filePath) || path.basename(filePath);
  } catch (_) {
    return filePath;
  }
}

function walkMarkdownFiles(folderPath, output = []) {
  if (!folderPath || !fs.existsSync(folderPath)) return output;
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(fullPath, output);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      output.push(fullPath);
    }
  }
  return output;
}

function applyExternalLayout(task, layout, index) {
  return {
    ...task,
    priority: layout?.priority ?? task.priority,
    category: layout?.category ?? task.category,
    note: layout?.note ?? task.note,
    x: layout?.x ?? 80 + (index % 4) * 360,
    y: layout?.y ?? 420 + Math.floor(index / 4) * 220,
  };
}

function externalLayoutFromTask(task) {
  const out = {
    x: Math.round(task.x || 0),
    y: Math.round(task.y || 0),
  };
  if (task.priority) out.priority = true;
  if (task.category) out.category = task.category;
  if (task.note) out.note = task.note;
  if (task.source?.filePath) out.filePath = task.source.filePath;
  if (task.source?.stableMarker) out.stableMarker = task.source.stableMarker;
  return out;
}

export class BoardStore extends EventEmitter {
  constructor({ userDataPath, boardPath = BOARD_PATH } = {}) {
    super();
    this.boardPath = boardPath;
    this.userDataPath = userDataPath || path.join(os.homedir(), 'Library', 'Application Support', 'Whiteboard Todos');
    this.statePath = path.join(this.userDataPath, 'whiteboard-index.json');
    this.state = sanitizeState(readJson(this.statePath, defaultState()));
    this.watcher = null;
    this.skipBoardWatch = false;
    this.skipExternalWatch = false;
    this.emitTimer = null;
    this.lastWarnings = [];
  }

  ensureBoardFile() {
    if (fs.existsSync(this.boardPath)) return;
    ensureDir(path.dirname(this.boardPath));
    fs.writeFileSync(this.boardPath, createDefaultBoardMarkdown(), 'utf-8');
  }

  saveState() {
    this.state = sanitizeState(this.state);
    writeJson(this.statePath, this.state);
  }

  getSyncInfo(externalTaskCount = 0) {
    return {
      ...this.state.sync,
      tags: normalizeSyncTags(this.state.sync.tags),
      externalTaskCount,
      boardPath: this.boardPath,
      statePath: this.statePath,
      warnings: this.lastWarnings,
    };
  }

  scanExternalTasks() {
    const sync = this.state.sync;
    if (!sync.enabled || !sync.folders.length) return [];

    const hidden = new Set(this.state.hiddenExternalTaskIds || []);
    const tags = normalizeSyncTags(sync.tags);
    const tasks = [];
    const seenFiles = new Set();

    for (const folder of sync.folders) {
      for (const filePath of walkMarkdownFiles(folder)) {
        if (seenFiles.has(filePath) || path.resolve(filePath) === path.resolve(this.boardPath)) continue;
        seenFiles.add(filePath);

        let lines;
        try {
          lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        } catch (_) {
          continue;
        }

        lines.forEach((line, index) => {
          const parsed = parseExternalTaskLine(line, {
            filePath,
            lineNumber: index + 1,
            syncTags: tags,
          });
          if (!parsed || hidden.has(parsed.id)) return;
          const layout = this.state.externalLayouts[parsed.id];
          tasks.push(applyExternalLayout({
            id: parsed.id,
            text: parsed.text,
            checked: parsed.checked,
            priority: parsed.priority,
            category: parsed.category,
            note: parsed.note,
            createdAt: null,
            completedAt: null,
            external: true,
            source: {
              ...parsed.source,
              displayPath: safeRelative(sync.vaultRoot || DEFAULT_VAULT_ROOT, filePath),
            },
          }, layout, tasks.length));
        });
      }
    }

    return tasks;
  }

  readBoard() {
    this.ensureBoardFile();
    const markdown = fs.readFileSync(this.boardPath, 'utf-8');
    const board = parseBoardMarkdown(markdown, this.boardPath);
    const externalTasks = this.scanExternalTasks();
    const tasks = [...board.tasks, ...externalTasks];

    return {
      tasks,
      labels: board.labels || [],
      areas: board.areas || [],
      categories: board.categories || [],
      sync: this.getSyncInfo(externalTasks.length),
    };
  }

  updateExternalCheckbox(task, warnings) {
    const source = task.source;
    if (!source?.filePath || !fs.existsSync(source.filePath)) {
      warnings.push(`Missing external source for ${task.id}`);
      return;
    }

    const raw = fs.readFileSync(source.filePath, 'utf-8');
    const lines = raw.split('\n');
    let lineIndex = -1;

    if (source.markerId || source.blockId || source.stableMarker) {
      const marker = source.markerId || source.blockId || source.stableMarker;
      lineIndex = lines.findIndex(line => (
        line.includes(`wb-id:${marker}`)
        || line.includes(`wb:${marker}`)
        || line.match(new RegExp(`\\^${marker}(\\s|$)`))
      ));
    }

    if (lineIndex === -1 && Number.isInteger(source.lineNumber) && source.lineNumber > 0) {
      const candidate = lines[source.lineNumber - 1];
      if (candidate && /^\s*[-*] \[[ xX]\]/.test(candidate)) lineIndex = source.lineNumber - 1;
    }

    if (lineIndex === -1) {
      warnings.push(`Could not find external todo line for ${task.id}`);
      return;
    }

    const currentLine = lines[lineIndex];
    const currentParsed = parseExternalTaskLine(currentLine, {
      filePath: source.filePath,
      lineNumber: lineIndex + 1,
      syncTags: this.state.sync.tags,
    });

    if (!currentParsed) {
      warnings.push(`External todo no longer matches sync tags for ${task.id}`);
      return;
    }

    if (currentParsed.checked === task.checked) return;

    const stableMarker = source.stableMarker || `wb-${stableHash(`${source.filePath}:${lineIndex}:${task.text}`, 10)}`;
    const result = updateExternalCheckboxLine(currentLine, task.checked, stableMarker);
    if (!result.changed) return;

    lines[lineIndex] = result.line;
    this.skipExternalWatch = true;
    fs.writeFileSync(source.filePath, lines.join('\n'), 'utf-8');
  }

  writeBoard(nextBoard) {
    this.ensureBoardFile();
    const warnings = [];
    const previousMarkdown = fs.readFileSync(this.boardPath, 'utf-8');
    const incomingTasks = nextBoard.tasks || [];
    const externalTasks = incomingTasks.filter(task => task?.source?.type === 'external' || task.external);
    const incomingExternalIds = new Set(externalTasks.map(task => task.id));

    for (const task of externalTasks) {
      this.state.externalLayouts[task.id] = externalLayoutFromTask(task);
      this.updateExternalCheckbox(task, warnings);
    }

    if (this.state.sync.enabled && this.state.sync.folders.length) {
      const currentScanned = this.scanExternalTasks();
      const hidden = new Set(this.state.hiddenExternalTaskIds || []);
      for (const scanned of currentScanned) {
        if (!incomingExternalIds.has(scanned.id)) hidden.add(scanned.id);
      }
      this.state.hiddenExternalTaskIds = [...hidden];
    }

    const markdown = serializeBoardMarkdown(nextBoard, previousMarkdown);
    this.skipBoardWatch = true;
    fs.writeFileSync(this.boardPath, markdown, 'utf-8');
    this.lastWarnings = warnings;
    this.saveState();
    this.scheduleEmit();
    return { ok: warnings.length === 0, warnings, board: this.readBoard() };
  }

  updateSyncSettings(patch = {}) {
    const nextSync = {
      ...this.state.sync,
      ...patch,
    };
    if (patch.tags) nextSync.tags = normalizeSyncTags(patch.tags);
    if (patch.folders) nextSync.folders = patch.folders.filter(Boolean);
    this.state.sync = nextSync;
    this.saveState();
    this.restartWatchers();
    this.scheduleEmit();
    return this.readBoard();
  }

  clearHiddenExternalTasks() {
    this.state.hiddenExternalTaskIds = [];
    this.saveState();
    this.scheduleEmit();
    return this.readBoard();
  }

  scheduleEmit() {
    clearTimeout(this.emitTimer);
    this.emitTimer = setTimeout(() => {
      try {
        this.emit('changed', this.readBoard());
      } catch (error) {
        this.emit('error', error);
      }
    }, WATCH_DEBOUNCE_MS);
  }

  restartWatchers() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    const watchPaths = [this.boardPath];
    if (this.state.sync.enabled) {
      watchPaths.push(...this.state.sync.folders.filter(folder => fs.existsSync(folder)));
    }

    this.watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      ignored: /(^|[/\\])\../,
    });

    this.watcher.on('change', (changedPath) => {
      if (path.resolve(changedPath) === path.resolve(this.boardPath)) {
        if (this.skipBoardWatch) {
          this.skipBoardWatch = false;
          return;
        }
      } else if (this.skipExternalWatch) {
        this.skipExternalWatch = false;
        return;
      }
      this.scheduleEmit();
    });
    this.watcher.on('add', () => this.scheduleEmit());
    this.watcher.on('unlink', () => this.scheduleEmit());
  }

  close() {
    clearTimeout(this.emitTimer);
    if (this.watcher) this.watcher.close();
  }
}

export function createBoardStore(options) {
  return new BoardStore(options);
}
