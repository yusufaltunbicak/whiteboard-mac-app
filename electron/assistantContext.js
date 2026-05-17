import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SETTINGS_FILE = 'voice-settings.json';
const MEMORY_FILE = 'assistant-memory.md';
const VOICE_FILE = 'assistant-voice.md';
const PROPOSALS_FILE = 'assistant-memory-proposals.json';
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_CONTEXT_READ_LINES = 80;
const MAX_CONTEXT_READ_CHARS = 8000;
const DEFAULT_MAX_RESULTS = 8;
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.canvas']);
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist', 'release', 'DerivedData']);
const QUESTION_STOP_WORDS = new Set([
  'acaba',
  'anlat',
  'bak',
  'bakar',
  'bakabilir',
  'bakarak',
  'bana',
  'bağlam',
  'baglam',
  'bir',
  'bu',
  'bunu',
  'da',
  'de',
  'detay',
  'detaylı',
  'detaylica',
  'detaylıca',
  'diye',
  'gibi',
  'hakkında',
  'hakkinda',
  'hangi',
  'hemen',
  'ile',
  'kim',
  'mı',
  'mi',
  'mu',
  'mü',
  'nasıl',
  'nasil',
  'ne',
  'neden',
  'nedir',
  'nerede',
  'nereye',
  'söyle',
  'soyle',
  'şu',
  'su',
  've',
]);

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return fallback;
  }
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function voicePath(userDataPath, fileName) {
  return path.join(userDataPath, fileName);
}

function defaultAssistantMemory() {
  return [
    '# Assistant Memory',
    '',
    'Persistent user preferences and durable task-context notes live here.',
    'The voice assistant may only add entries after it proposes them and the user approves.',
    '',
  ].join('\n');
}

function defaultAssistantVoice() {
  return [
    '# Assistant Voice',
    '',
    '- Speak in the user\'s language when clear; Turkish is acceptable by default.',
    '- Keep spoken replies brief, practical, and conversational.',
    '- For clear board commands, act quickly and mention that undo is available.',
    '- For inferred task suggestions from context, ask before creating tasks.',
    '- Never claim a board change is complete until the tool call succeeds.',
    '',
  ].join('\n');
}

export function defaultVoiceSettings() {
  return {
    version: 1,
    enabled: true,
    shortcut: 'Alt+Space',
    model: 'gpt-realtime-2',
    voice: 'marin',
    reasoningEffort: 'low',
    allowedFolders: [],
    contextMaxResults: DEFAULT_MAX_RESULTS,
  };
}

export function sanitizeVoiceSettings(raw = {}) {
  const base = defaultVoiceSettings();
  const allowedFolders = Array.isArray(raw.allowedFolders)
    ? raw.allowedFolders
      .filter(Boolean)
      .map(folder => path.resolve(String(folder)))
    : [];

  return {
    ...base,
    ...raw,
    version: 1,
    enabled: raw.enabled == null ? base.enabled : Boolean(raw.enabled),
    shortcut: String(raw.shortcut || base.shortcut).trim() || base.shortcut,
    model: String(raw.model || base.model).trim() || base.model,
    voice: String(raw.voice || base.voice).trim() || base.voice,
    reasoningEffort: String(raw.reasoningEffort || base.reasoningEffort).trim() || base.reasoningEffort,
    allowedFolders: [...new Set(allowedFolders)],
    contextMaxResults: Number.isFinite(raw.contextMaxResults)
      ? Math.max(1, Math.min(20, raw.contextMaxResults))
      : base.contextMaxResults,
  };
}

export function readVoiceSettings(userDataPath) {
  return sanitizeVoiceSettings(readJson(voicePath(userDataPath, SETTINGS_FILE), defaultVoiceSettings()));
}

export function writeVoiceSettings(userDataPath, settings) {
  const clean = sanitizeVoiceSettings(settings);
  writeJson(voicePath(userDataPath, SETTINGS_FILE), clean);
  return clean;
}

export function ensureAssistantDocs(userDataPath) {
  ensureDir(userDataPath);
  const memoryPath = voicePath(userDataPath, MEMORY_FILE);
  const voiceTonePath = voicePath(userDataPath, VOICE_FILE);

  if (!fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, defaultAssistantMemory(), 'utf-8');
  if (!fs.existsSync(voiceTonePath)) fs.writeFileSync(voiceTonePath, defaultAssistantVoice(), 'utf-8');

  return { memoryPath, voiceTonePath };
}

export function readAssistantDocs(userDataPath) {
  const paths = ensureAssistantDocs(userDataPath);
  return {
    ...paths,
    memory: fs.readFileSync(paths.memoryPath, 'utf-8'),
    voice: fs.readFileSync(paths.voiceTonePath, 'utf-8'),
  };
}

function readProposals(userDataPath) {
  return readJson(voicePath(userDataPath, PROPOSALS_FILE), []);
}

function writeProposals(userDataPath, proposals) {
  writeJson(voicePath(userDataPath, PROPOSALS_FILE), proposals.slice(-50));
}

export function proposeMemoryEntry(userDataPath, proposal = {}) {
  const content = String(proposal.content || proposal.entry || '').trim();
  if (!content) throw new Error('Memory proposal content is required');

  const proposals = readProposals(userDataPath);
  const next = {
    id: proposal.id || `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    content,
    reason: String(proposal.reason || '').trim() || null,
    createdAt: new Date().toISOString(),
  };
  writeProposals(userDataPath, [...proposals, next]);
  return next;
}

export function applyMemoryEntry(userDataPath, input = {}) {
  const proposalId = typeof input === 'string' ? input : input.proposalId || input.id;
  const directContent = typeof input === 'object' ? String(input.content || input.entry || '').trim() : '';
  let proposals = readProposals(userDataPath);
  let proposal = proposalId ? proposals.find(item => item.id === proposalId) : null;

  if (!proposal && directContent) {
    proposal = { id: null, content: directContent, reason: input.reason || null };
  }

  if (!proposal?.content) throw new Error('Approved memory entry was not found');

  const { memoryPath } = ensureAssistantDocs(userDataPath);
  const stamp = new Date().toISOString().slice(0, 10);
  const reason = proposal.reason ? ` (${proposal.reason})` : '';
  fs.appendFileSync(memoryPath, `\n- ${stamp}${reason}: ${proposal.content}\n`, 'utf-8');

  if (proposal.id) {
    proposals = proposals.filter(item => item.id !== proposal.id);
    writeProposals(userDataPath, proposals);
  }

  return {
    ok: true,
    memoryPath,
    applied: proposal,
  };
}

function isHiddenOrSkippedDir(dirent) {
  if (!dirent.isDirectory()) return false;
  return dirent.name.startsWith('.') || SKIPPED_DIRS.has(dirent.name);
}

function isTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (_) {
    return null;
  }
}

function walkTextFiles(root, output = []) {
  const stat = safeStat(root);
  if (!stat) return output;

  if (stat.isFile()) {
    if (isTextFile(root) && stat.size <= MAX_TEXT_FILE_BYTES) output.push(root);
    return output;
  }

  if (!stat.isDirectory()) return output;

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return output;
  }

  for (const entry of entries) {
    if (isHiddenOrSkippedDir(entry)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkTextFiles(fullPath, output);
    } else if (entry.isFile()) {
      const fileStat = safeStat(fullPath);
      if (fileStat && isTextFile(fullPath) && fileStat.size <= MAX_TEXT_FILE_BYTES) {
        output.push(fullPath);
      }
    }
  }

  return output;
}

export function isPathInside(childPath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(childPath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function uniquePaths(paths = []) {
  return [...new Set(paths.filter(Boolean).map(item => path.resolve(item)))];
}

function resolveContextPath(filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function isAllowedContextFile(filePath, roots = [], exactFiles = []) {
  const resolved = path.resolve(resolveContextPath(filePath));
  if (exactFiles.some(item => item && path.resolve(item) === resolved)) return true;
  return roots.some(root => {
    const rootPath = path.resolve(root);
    return resolved === rootPath || isPathInside(resolved, rootPath);
  });
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '');
}

function tokenizeQuery(value) {
  return normalizeSearchText(value)
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(term => term.trim())
    .filter(term => term.length >= 2 && !QUESTION_STOP_WORDS.has(term));
}

function buildSearchTerms({ query, queries = [] }) {
  const rawQueries = [query, ...(Array.isArray(queries) ? queries : [])]
    .map(item => String(item || '').trim())
    .filter(Boolean);
  const terms = [...new Set(rawQueries.flatMap(tokenizeQuery))];
  const compactTerms = rawQueries
    .map(tokenizeQuery)
    .map(parts => parts.join(''))
    .filter(term => term.length >= 4);
  const phrases = rawQueries
    .map(normalizeSearchText)
    .map(item => item.replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim())
    .filter(item => item.length >= 4 && item.split(/\s+/).length > 1);
  const termPhrases = rawQueries
    .map(tokenizeQuery)
    .map(parts => parts.join(' '))
    .filter(item => item.length >= 4 && item.split(/\s+/).length > 1);

  return {
    rawQueries,
    terms: [...new Set([...terms, ...compactTerms])],
    phrases: [...new Set([...phrases, ...termPhrases])],
  };
}

function scoreText(text, terms, phrases = []) {
  const lower = normalizeSearchText(text);
  const termScore = terms.reduce((score, term) => {
    if (!term) return score;
    const matches = lower.split(term).length - 1;
    return score + matches;
  }, 0);
  const phraseScore = phrases.reduce((score, phrase) => {
    if (!phrase) return score;
    const matches = lower.split(phrase).length - 1;
    return score + (matches * 4);
  }, 0);
  const allTermsBonus = terms.length > 1 && terms.every(term => lower.includes(term)) ? terms.length : 0;
  return termScore + phraseScore + allTermsBonus;
}

function snippetAround(lines, index) {
  const start = Math.max(0, index - 2);
  const end = Math.min(lines.length, index + 3);
  return lines.slice(start, end).join('\n').trim().slice(0, 900);
}

function displayPath(filePath) {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~/${path.relative(home, filePath)}` : filePath;
}

function firstUsefulSnippet(lines) {
  const index = lines.findIndex(line => line.trim() && !line.trim().startsWith('---'));
  return snippetAround(lines, Math.max(0, index));
}

export function searchLocalContext({
  userDataPath,
  boardPath,
  syncFolders = [],
  allowedFolders = [],
  query,
  queries = [],
  depth = 'quick',
  maxResults = DEFAULT_MAX_RESULTS,
} = {}) {
  const { rawQueries, terms, phrases } = buildSearchTerms({ query, queries });

  if (!terms.length) {
    return { query: query || '', queries: rawQueries, terms: [], roots: [], results: [] };
  }

  const docs = userDataPath ? ensureAssistantDocs(userDataPath) : {};
  const roots = uniquePaths([
    ...(allowedFolders || []),
    ...(syncFolders || []),
  ]);
  const files = uniquePaths([
    boardPath,
    docs.memoryPath,
    docs.voiceTonePath,
    ...roots.flatMap(root => walkTextFiles(root)),
  ]);
  const results = [];
  const seenResults = new Set();

  for (const filePath of files) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    const stat = safeStat(filePath);
    if (!stat?.isFile() || stat.size > MAX_TEXT_FILE_BYTES) continue;

    let lines = [];
    try {
      lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    } catch (_) {
      continue;
    }

    const pathScore = scoreText(`${filePath}\n${displayPath(filePath)}`, terms, phrases);
    if (pathScore > 0) {
      const key = `${filePath}:path`;
      seenResults.add(key);
      results.push({
        filePath,
        displayPath: displayPath(filePath),
        line: 1,
        score: pathScore + 3,
        matchType: 'path',
        snippet: firstUsefulSnippet(lines),
      });
    }

    lines.forEach((line, index) => {
      const score = scoreText(line, terms, phrases);
      if (score <= 0) return;
      const key = `${filePath}:${index + 1}`;
      if (seenResults.has(key)) return;
      seenResults.add(key);
      results.push({
        filePath,
        displayPath: displayPath(filePath),
        line: index + 1,
        score,
        matchType: 'content',
        snippet: snippetAround(lines, index),
      });
    });
  }

  results.sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath) || a.line - b.line);
  const limit = Math.max(1, Math.min(30, maxResults || (depth === 'deep' ? 16 : DEFAULT_MAX_RESULTS)));

  return {
    query,
    queries: rawQueries,
    terms,
    roots: roots.map(displayPath),
    searchedFileCount: files.length,
    resultCount: results.length,
    results: results.slice(0, limit),
  };
}

export function readLocalContextFile({
  userDataPath,
  boardPath,
  syncFolders = [],
  allowedFolders = [],
  filePath,
  line = 1,
  before = 20,
  after = 40,
} = {}) {
  const docs = userDataPath ? ensureAssistantDocs(userDataPath) : {};
  const roots = uniquePaths([
    ...(allowedFolders || []),
    ...(syncFolders || []),
  ]);
  const exactFiles = uniquePaths([boardPath, docs.memoryPath, docs.voiceTonePath]);
  const resolvedPath = path.resolve(resolveContextPath(filePath));

  if (!isAllowedContextFile(resolvedPath, roots, exactFiles)) {
    return {
      ok: false,
      error: 'File is outside allowed voice context.',
      displayPath: displayPath(resolvedPath),
    };
  }

  const stat = safeStat(resolvedPath);
  if (!stat?.isFile() || !isTextFile(resolvedPath) || stat.size > MAX_TEXT_FILE_BYTES) {
    return {
      ok: false,
      error: 'File is not a readable text context file.',
      displayPath: displayPath(resolvedPath),
    };
  }

  let lines = [];
  try {
    lines = fs.readFileSync(resolvedPath, 'utf-8').split('\n');
  } catch (_) {
    return {
      ok: false,
      error: 'File could not be read.',
      displayPath: displayPath(resolvedPath),
    };
  }

  const center = Math.max(1, Math.min(lines.length, Number(line) || 1));
  const beforeLines = Math.max(0, Math.min(60, Number(before) || 0));
  const afterLines = Math.max(0, Math.min(60, Number(after) || 0));
  const startLine = Math.max(1, center - beforeLines);
  const endLine = Math.min(lines.length, Math.min(startLine + MAX_CONTEXT_READ_LINES - 1, center + afterLines));
  const snippet = lines.slice(startLine - 1, endLine).join('\n').trim().slice(0, MAX_CONTEXT_READ_CHARS);

  return {
    ok: true,
    filePath: resolvedPath,
    displayPath: displayPath(resolvedPath),
    startLine,
    endLine,
    totalLines: lines.length,
    snippet,
  };
}
