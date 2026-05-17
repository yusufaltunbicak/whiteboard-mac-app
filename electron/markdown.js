import crypto from 'node:crypto';
import matter from 'gray-matter';

export const DEFAULT_CATEGORIES = [
  { id: 'ux-ui', name: 'UX/UI', color: '#E2535B' },
  { id: 'errands', name: 'errands', color: '#8575B5' },
  { id: 'work', name: 'work', color: '#4A90D9' },
  { id: 'personal', name: 'personal', color: '#E87461' },
  { id: 'ideas', name: 'ideas', color: '#5BAE7C' },
];

export const DEFAULT_SYNC_TAGS = ['#whiteboard', '#wb'];

const TASK_LINE_RE = /^(\s*)([-*]) \[([ xX])\] (.*)$/;
const HTML_COMMENT_RE = /\s*<!--\s*([^>]+?)\s*-->\s*$/;
const BLOCK_ID_RE = /\s+\^([A-Za-z0-9_-]+)\s*$/;
const META_RE = /([A-Za-z][\w-]*):("[^"]*"|'[^']*'|[^\s]+)/g;

export function genId(prefix = '') {
  return `${prefix}${Math.random().toString(36).substring(2, 8)}`;
}

export function stableHash(value, length = 12) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, length);
}

function normalizeMetaValue(value) {
  if (!value) return value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseTaskMeta(comment = '') {
  const meta = {};
  for (const match of comment.matchAll(META_RE)) {
    meta[match[1]] = normalizeMetaValue(match[2]);
  }
  return meta;
}

function stripSyncTags(text, syncTags = []) {
  let next = text;
  for (const tag of syncTags) {
    const normalized = tag.startsWith('#') ? tag : `#${tag}`;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'giu'), ' ');
  }
  return next.replace(/\s+/g, ' ').trim();
}

function extractTaskParts(line) {
  const match = line.match(TASK_LINE_RE);
  if (!match) return null;

  let rest = match[4].trim();
  const comments = [];
  let meta = {};

  while (true) {
    const commentMatch = rest.match(HTML_COMMENT_RE);
    if (!commentMatch) break;
    comments.unshift(commentMatch[1]);
    meta = { ...parseTaskMeta(commentMatch[1]), ...meta };
    rest = rest.slice(0, commentMatch.index).trimEnd();
  }

  let blockId = null;
  const blockMatch = rest.match(BLOCK_ID_RE);
  if (blockMatch) {
    blockId = blockMatch[1];
    rest = rest.slice(0, blockMatch.index).trimEnd();
  }

  return {
    indent: match[1],
    bullet: match[2],
    checked: match[3].toLowerCase() === 'x',
    rest,
    comments,
    meta,
    blockId,
  };
}

export function parseTaskLine(line, options = {}) {
  const parts = extractTaskParts(line);
  if (!parts) return null;

  const {
    source = { type: 'board' },
    fallbackId = () => genId(),
    syncTags = [],
    stripConfiguredSyncTags = false,
  } = options;

  let rest = stripConfiguredSyncTags ? stripSyncTags(parts.rest, syncTags) : parts.rest;

  let note = null;
  const noteIndex = rest.lastIndexOf(' // ');
  if (noteIndex !== -1) {
    note = rest.slice(noteIndex + 4).trim();
    rest = rest.slice(0, noteIndex).trim();
  }

  let priority = false;
  if (rest.includes('!!!')) {
    priority = true;
    rest = rest.replace(/\s*!!!\s*/g, ' ').trim();
  }

  let category = null;
  const categoryMatch = rest.match(/(^|\s)#([\p{L}\p{N}_-]+)/u);
  if (categoryMatch) {
    category = categoryMatch[2];
    rest = `${rest.slice(0, categoryMatch.index)} ${rest.slice(categoryMatch.index + categoryMatch[0].length)}`.trim();
  }

  const metaId = parts.meta.id || parts.meta['wb-id'] || parts.meta.wb;
  const id = metaId || fallbackId({ rest, parts });

  return {
    id,
    text: rest.trim(),
    checked: parts.checked,
    priority,
    category,
    note,
    createdAt: parts.meta.createdAt || null,
    completedAt: parts.meta.completedAt || null,
    source,
    parseInfo: {
      indent: parts.indent,
      blockId: parts.blockId,
      markerId: parts.meta['wb-id'] || parts.meta.wb || null,
      meta: parts.meta,
      rawLine: line,
    },
  };
}

export function serializeBoardTask(task) {
  let line = `- [${task.checked ? 'x' : ' '}] ${task.text || ''}`.trimEnd();
  if (task.category) line += ` #${task.category}`;
  if (task.priority) line += ' !!!';
  if (task.note) line += ` // ${task.note}`;

  const meta = [`id:${task.id}`];
  if (task.createdAt) meta.push(`createdAt:${task.createdAt}`);
  if (task.checked && task.completedAt) meta.push(`completedAt:${task.completedAt}`);
  line += ` <!-- ${meta.join(' ')} -->`;
  return line;
}

function cleanLabels(labels = []) {
  return labels
    .filter(label => label.text)
    .map((label) => {
      const out = {
        id: label.id,
        text: label.text,
        x: Math.round(label.x || 0),
        y: Math.round(label.y || 0),
      };
      if (label.rotate) out.rotate = label.rotate;
      if (label.color) out.color = label.color;
      if (typeof label.opacity === 'number' && label.opacity !== 1) out.opacity = label.opacity;
      if (label.faded) out.faded = true;
      if (label.size) out.size = label.size;
      return out;
    });
}

function cleanAreas(areas = []) {
  return areas.map((area) => {
    const out = {
      id: area.id,
      x: Math.round(area.x || 0),
      y: Math.round(area.y || 0),
      width: Math.round(area.width || 0),
      height: Math.round(area.height || 0),
      color: area.color,
      opacity: area.opacity,
    };
    if (area.locked) out.locked = true;
    return out;
  });
}

export function parseBoardMarkdown(markdown, boardPath = null) {
  const parsed = matter(markdown || '');
  const positions = parsed.data.positions || {};
  const lines = parsed.content.split('\n');
  let generated = 0;

  const tasks = lines
    .map((line) => parseTaskLine(line, {
      source: { type: 'board', filePath: boardPath },
      fallbackId: () => genId(`task${generated += 1}-`),
    }))
    .filter(Boolean)
    .map((task, index) => {
      const position = positions[task.id];
      return {
        id: task.id,
        text: task.text,
        checked: task.checked,
        priority: task.priority,
        category: task.category,
        note: task.note,
        createdAt: task.createdAt,
        completedAt: task.checked ? task.completedAt : null,
        source: task.source,
        x: position ? position[0] : undefined,
        y: position ? position[1] : undefined,
        _lineIndex: index,
      };
    });

  return {
    tasks,
    labels: parsed.data.labels || [],
    areas: parsed.data.areas || [],
    categories: parsed.data.categories || DEFAULT_CATEGORIES,
    frontmatter: parsed.data || {},
    content: parsed.content,
  };
}

export function serializeBoardMarkdown(board, previousMarkdown = '') {
  const parsed = matter(previousMarkdown || '');
  const previousLines = parsed.content ? parsed.content.split('\n') : [];
  const localTasks = (board.tasks || []).filter(task => task?.source?.type !== 'external' && !task.external);
  const tasksById = new Map(localTasks.map(task => [task.id, task]));
  const seen = new Set();
  let hadTaskLine = false;

  const nextLines = previousLines.map((line) => {
    const parsedTask = parseTaskLine(line, { fallbackId: () => null });
    if (!parsedTask?.id) return line;
    hadTaskLine = true;
    const nextTask = tasksById.get(parsedTask.id);
    if (!nextTask) return null;
    seen.add(parsedTask.id);
    const indent = parsedTask.parseInfo?.indent || '';
    return `${indent}${serializeBoardTask(nextTask)}`;
  }).filter(line => line !== null);

  const newLines = localTasks
    .filter(task => !seen.has(task.id))
    .map(serializeBoardTask);

  let contentLines = nextLines;
  if (!contentLines.some(line => /^#\s+Whiteboard Todos\s*$/.test(line))) {
    contentLines = ['', '# Whiteboard Todos', '', ...contentLines.filter(Boolean)];
  }
  if (!hadTaskLine && newLines.length > 0 && contentLines[contentLines.length - 1] !== '') {
    contentLines.push('');
  }
  contentLines.push(...newLines);

  const positions = {};
  localTasks.forEach((task) => {
    if (task.x != null && task.y != null) positions[task.id] = [Math.round(task.x), Math.round(task.y)];
  });

  const frontmatter = {
    ...(parsed.data || {}),
    categories: board.categories || DEFAULT_CATEGORIES,
    labels: cleanLabels(board.labels || []),
    areas: cleanAreas(board.areas || []),
    positions,
  };

  return matter.stringify(`${contentLines.join('\n').replace(/\s+$/, '')}\n`, frontmatter);
}

export function createDefaultBoardMarkdown() {
  const content = '\n# Whiteboard Todos\n\n- [ ] Add your first task! #ideas <!-- id:init01 -->\n';
  return matter.stringify(content, {
    categories: DEFAULT_CATEGORIES,
    positions: { init01: [40, 20] },
    labels: [],
    areas: [],
  });
}

export function normalizeSyncTags(tags = DEFAULT_SYNC_TAGS) {
  return [...new Set((tags || DEFAULT_SYNC_TAGS)
    .map(tag => String(tag || '').trim())
    .filter(Boolean)
    .map(tag => (tag.startsWith('#') ? tag : `#${tag}`)))];
}

export function lineHasSyncTag(line, tags = DEFAULT_SYNC_TAGS) {
  const normalized = normalizeSyncTags(tags);
  return normalized.some((tag) => {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'iu').test(line);
  });
}

export function externalMarkerFor(filePath, lineNumber, text) {
  return `wb-${stableHash(`${filePath}:${lineNumber}:${text}`, 10)}`;
}

export function parseExternalTaskLine(line, context) {
  const { filePath, lineNumber, syncTags = DEFAULT_SYNC_TAGS } = context;
  if (!lineHasSyncTag(line, syncTags)) return null;

  const parts = extractTaskParts(line);
  if (!parts) return null;

  const markerId = parts.meta['wb-id'] || parts.meta.wb || parts.blockId || null;
  const fallbackMarker = externalMarkerFor(filePath, lineNumber, parts.rest);
  const stableMarker = markerId || fallbackMarker;
  const fileHash = stableHash(filePath, 10);
  const id = `ext:${fileHash}:${stableMarker}`;
  const parsed = parseTaskLine(line, {
    source: {
      type: 'external',
      filePath,
      lineNumber,
      markerId,
      stableMarker,
      needsStableMarker: !markerId,
      rawLine: line,
    },
    fallbackId: () => id,
    syncTags,
    stripConfiguredSyncTags: true,
  });

  if (!parsed) return null;

  return {
    ...parsed,
    id,
    external: true,
    source: {
      type: 'external',
      filePath,
      lineNumber,
      markerId,
      stableMarker,
      blockId: parts.blockId,
      needsStableMarker: !markerId,
      rawLine: line,
    },
  };
}

export function updateExternalCheckboxLine(line, checked, stableMarker) {
  const parts = extractTaskParts(line);
  if (!parts) return { line, changed: false, markerAdded: false };

  const checkboxUpdated = line.replace(TASK_LINE_RE, (full, indent, bullet, oldChecked, rest) => (
    `${indent}${bullet} [${checked ? 'x' : ' '}] ${rest}`
  ));

  const hasStableMarker = Boolean(parts.meta['wb-id'] || parts.meta.wb || parts.blockId);
  if (hasStableMarker || !stableMarker) {
    return { line: checkboxUpdated, changed: checkboxUpdated !== line, markerAdded: false };
  }

  const withMarker = `${checkboxUpdated} <!-- wb-id:${stableMarker} -->`;
  return { line: withMarker, changed: withMarker !== line, markerAdded: true };
}
