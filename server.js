import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import matter from 'gray-matter';
import chokidar from 'chokidar';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const MD_PATH = join(homedir(), 'Documents', 'Second brain', 'whiteboard-todos.md');
const PORT = Number(process.env.PORT || 3001);

const DEFAULT_CATEGORIES = [
  { id: 'ux-ui', name: 'UX/UI', color: '#E2535B' },
  { id: 'errands', name: 'errands', color: '#8575B5' },
  { id: 'work', name: 'work', color: '#4A90D9' },
  { id: 'personal', name: 'personal', color: '#E87461' },
  { id: 'ideas', name: 'ideas', color: '#5BAE7C' },
];

function genId() {
  return Math.random().toString(36).substring(2, 8);
}

function parseTaskMeta(comment) {
  const meta = {};

  for (const match of comment.matchAll(/([A-Za-z]\w*):([^\s]+)/g)) {
    meta[match[1]] = match[2];
  }

  return meta;
}

function parseTask(line) {
  const m = line.match(/^- \[([ x])\] (.+)$/);
  if (!m) return null;
  const checked = m[1] === 'x';
  let rest = m[2];

  // Extract metadata from <!-- id:xxx createdAt:... completedAt:... -->
  let id;
  let createdAt = null;
  let completedAt = null;
  const metaM = rest.match(/\s*<!--\s*([^>]+)\s*-->\s*$/);
  if (metaM) {
    const meta = parseTaskMeta(metaM[1]);
    id = meta.id || genId();
    createdAt = meta.createdAt || null;
    completedAt = meta.completedAt || null;
    rest = rest.slice(0, metaM.index).trim();
  } else {
    id = genId();
  }

  // Extract note from // text
  let note = null;
  const ni = rest.lastIndexOf(' // ');
  if (ni !== -1) { note = rest.slice(ni + 4).trim(); rest = rest.slice(0, ni).trim(); }

  // Extract priority !!!
  let priority = false;
  if (rest.includes('!!!')) { priority = true; rest = rest.replace(/\s*!!!\s*/g, ' ').trim(); }

  // Extract category #xxx
  let category = null;
  const cm = rest.match(/#([\w-]+)/);
  if (cm) { category = cm[1]; rest = rest.replace(/\s*#[\w-]+/, '').trim(); }

  return { id, text: rest, checked, priority, category, note, createdAt, completedAt };
}

function serializeTask(t) {
  let line = `- [${t.checked ? 'x' : ' '}] ${t.text}`;
  if (t.category) line += ` #${t.category}`;
  if (t.priority) line += ' !!!';
  if (t.note) line += ` // ${t.note}`;
  const meta = [`id:${t.id}`];
  if (t.createdAt) meta.push(`createdAt:${t.createdAt}`);
  if (t.checked && t.completedAt) meta.push(`completedAt:${t.completedAt}`);
  line += ` <!-- ${meta.join(' ')} -->`;
  return line;
}

function ensureFile() {
  if (!existsSync(MD_PATH)) {
    const content = '\n# Whiteboard Todos\n\n- [ ] Add your first task! #ideas <!-- id:init01 -->\n';
    writeFileSync(MD_PATH, matter.stringify(content, {
      categories: DEFAULT_CATEGORIES,
      positions: { init01: [40, 20] },
      labels: [],
      areas: [],
    }), 'utf-8');
  }
}

function readBoard() {
  ensureFile();
  const { data, content } = matter(readFileSync(MD_PATH, 'utf-8'));
  const lines = content.split('\n').filter(l => /^- \[[ x]\]/.test(l));
  const tasks = lines.map(parseTask).filter(Boolean);

  const pos = data.positions || {};
  tasks.forEach(t => {
    if (pos[t.id]) { t.x = pos[t.id][0]; t.y = pos[t.id][1]; }
  });

  return {
    tasks,
    labels: data.labels || [],
    areas: data.areas || [],
    categories: data.categories || DEFAULT_CATEGORIES,
  };
}

let skipWatch = false;

function writeBoard(board) {
  const positions = {};
  board.tasks.forEach(t => {
    if (t.x != null && t.y != null) positions[t.id] = [Math.round(t.x), Math.round(t.y)];
  });

  const cleanLabels = (board.labels || [])
    .filter(l => l.text)
    .map(l => {
      const out = { id: l.id, text: l.text, x: Math.round(l.x), y: Math.round(l.y) };
      if (l.rotate) out.rotate = l.rotate;
      if (l.color) out.color = l.color;
      if (l.faded) out.faded = true;
      if (l.size) out.size = l.size;
      return out;
    });

  const cleanAreas = (board.areas || [])
    .map((area) => {
      const out = {
        id: area.id,
        x: Math.round(area.x),
        y: Math.round(area.y),
        width: Math.round(area.width),
        height: Math.round(area.height),
        color: area.color,
        opacity: area.opacity,
      };

      if (area.locked) out.locked = true;

      return out;
    });

  const taskLines = board.tasks.map(serializeTask).join('\n');
  const content = `\n# Whiteboard Todos\n\n${taskLines}\n`;

  skipWatch = true;
  writeFileSync(MD_PATH, matter.stringify(content, {
    categories: board.categories,
    labels: cleanLabels,
    areas: cleanAreas,
    positions,
  }), 'utf-8');
}

// API
app.get('/api/board', (_, res) => {
  try { res.json(readBoard()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/board', (req, res) => {
  try { writeBoard(req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// SSE for live file watching
const clients = new Set();
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

chokidar.watch(MD_PATH, { ignoreInitial: true }).on('change', () => {
  if (skipWatch) { skipWatch = false; return; }
  try {
    const json = JSON.stringify(readBoard());
    for (const c of clients) c.write(`data: ${json}\n\n`);
  } catch (_) { /* partial write, ignore */ }
});

// Production static files
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist'));
}

app.listen(PORT, () => console.log(`Whiteboard Todos API -> http://localhost:${PORT}`));
