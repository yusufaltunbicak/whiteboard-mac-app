import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyBoardActions } from '../src/boardActions.js';
import {
  applyMemoryEntry,
  proposeMemoryEntry,
  readAssistantDocs,
  readLocalContextFile,
  searchLocalContext,
} from '../electron/assistantContext.js';
import { normalizeApiKey } from '../electron/voiceKey.js';
import {
  buildVoiceRuntimeContext,
  classifyVoiceRequest,
  createTaskDraft,
  discardTaskDraft,
  draftTasksToBoardActions,
  getDraftSelection,
  markDraftApplied,
  readTaskDrafts,
  recordVoiceSessionEvent,
  summarizeBoardActionResult,
  updateTaskDraft,
  updateVoiceSessionSummary,
} from '../electron/voiceRuntime.js';

function baseBoard() {
  return {
    tasks: [
      { id: 'task-a', text: 'Call partner', checked: false, priority: false, category: 'work', note: null, x: 10, y: 20 },
      { id: 'task-b', text: 'Buy coffee', checked: false, priority: false, category: null, note: null, x: 40, y: 50 },
    ],
    labels: [{ id: 'lbl-a', text: 'TODAY', x: 0, y: 0 }],
    categories: [{ id: 'work', name: 'work', color: '#4A90D9' }],
    areas: [{ id: 'area-a', x: 0, y: 0, width: 120, height: 90, color: '#4A90D9', opacity: 0.12 }],
  };
}

test('board actions create, update, move, bulk update, and delete tasks', () => {
  let id = 0;
  const { board, results } = applyBoardActions(baseBoard(), [
    { type: 'create_task', text: 'Draft launch note', category: 'work', priority: true, x: 100, y: 110 },
    { type: 'update_task', id: 'task-a', patch: { note: 'Use warm intro', checked: true } },
    { type: 'move_tasks', ids: ['task-a', 'task-b'], dx: 10, dy: -5 },
    { type: 'bulk_update_tasks', ids: ['task-a', 'task-b'], patch: { priority: true } },
    { type: 'delete_tasks', ids: ['task-b'] },
  ], {
    now: () => '2026-05-17T00:00:00.000Z',
    genId: prefix => `${prefix}${id += 1}`,
  });

  assert.equal(results.length, 5);
  assert.equal(board.tasks.length, 2);
  assert.equal(board.tasks.find(task => task.id === 'task-1').text, 'Draft launch note');
  assert.equal(board.tasks.find(task => task.id === 'task-a').checked, true);
  assert.equal(board.tasks.find(task => task.id === 'task-a').completedAt, '2026-05-17T00:00:00.000Z');
  assert.equal(board.tasks.find(task => task.id === 'task-a').x, 20);
  assert.equal(board.tasks.find(task => task.id === 'task-a').priority, true);
  assert.equal(board.tasks.some(task => task.id === 'task-b'), false);
});

test('board actions cover labels, areas, and categories', () => {
  const { board } = applyBoardActions(baseBoard(), [
    { type: 'create_label', id: 'lbl-b', text: 'NEXT', x: 20, y: 30 },
    { type: 'update_label', id: 'lbl-a', patch: { text: 'NOW', color: '#E2535B' } },
    { type: 'create_area', id: 'area-b', x: 10, y: 20, width: 240, height: 160, color: '#5BAE7C' },
    { type: 'update_area', id: 'area-a', patch: { locked: true } },
    { type: 'create_category', id: 'ops', name: 'ops', color: '#D4A853' },
    { type: 'update_category', id: 'work', patch: { name: 'deep work' } },
    { type: 'delete_category', id: 'ops' },
  ]);

  assert.equal(board.labels.find(label => label.id === 'lbl-a').text, 'NOW');
  assert.equal(board.labels.find(label => label.id === 'lbl-b').x, 20);
  assert.equal(board.areas.find(area => area.id === 'area-a').locked, true);
  assert.equal(board.areas.find(area => area.id === 'area-b').width, 240);
  assert.equal(board.categories.find(category => category.id === 'work').name, 'deep work');
  assert.equal(board.categories.some(category => category.id === 'ops'), false);
});

test('external task source text is read-only for voice actions', () => {
  const board = baseBoard();
  board.tasks.push({
    id: 'ext-a',
    text: 'Source owned',
    checked: false,
    external: true,
    source: { type: 'external' },
  });

  assert.throws(() => applyBoardActions(board, [
    { type: 'update_task', id: 'ext-a', patch: { text: 'Changed' } },
  ]), /External task text is read-only/);

  const { board: updated } = applyBoardActions(board, [
    { type: 'update_task', id: 'ext-a', patch: { priority: true, note: 'sidecar' } },
  ]);
  assert.equal(updated.tasks.find(task => task.id === 'ext-a').priority, true);
  assert.equal(updated.tasks.find(task => task.id === 'ext-a').note, 'sidecar');
});

test('local context search stays inside allowed folders and reads assistant docs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-voice-'));
  const userDataPath = path.join(root, 'user-data');
  const allowed = path.join(root, 'vault');
  const outside = path.join(root, 'outside');
  const boardPath = path.join(root, 'whiteboard-todos.md');

  fs.mkdirSync(allowed, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(boardPath, '- [ ] Board alpha task <!-- id:a -->\n', 'utf-8');
  fs.writeFileSync(path.join(allowed, 'Project.md'), 'Alpha project note\n', 'utf-8');
  fs.writeFileSync(path.join(outside, 'Secret.md'), 'Alpha secret should not appear\n', 'utf-8');

  const results = searchLocalContext({
    userDataPath,
    boardPath,
    allowedFolders: [allowed],
    query: 'alpha',
    maxResults: 10,
  });

  assert.equal(results.results.some(item => item.filePath.includes('Secret.md')), false);
  assert.equal(results.results.some(item => item.filePath.includes('Project.md')), true);
  assert.equal(results.results.some(item => item.filePath === boardPath), true);
  assert.ok(readAssistantDocs(userDataPath).memory.includes('Assistant Memory'));
});

test('local context search uses project path matches and ignores question filler words', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-context-name-'));
  const userDataPath = path.join(root, 'user-data');
  const allowed = path.join(root, 'ArmorBroker-Ticketing-System');
  const boardPath = path.join(root, 'whiteboard-todos.md');

  fs.mkdirSync(allowed, { recursive: true });
  fs.writeFileSync(boardPath, '- [ ] Review support desk plan <!-- id:a -->\n', 'utf-8');
  fs.writeFileSync(path.join(allowed, 'README.md'), 'Service desk workflow for brokers and support teams.\n', 'utf-8');

  const results = searchLocalContext({
    userDataPath,
    boardPath,
    allowedFolders: [allowed],
    query: 'armor broker nedir diye detaylı bak',
    maxResults: 5,
  });

  assert.equal(results.terms.includes('nedir'), false);
  assert.equal(results.results.some(item => item.matchType === 'path' && item.displayPath.includes('ArmorBroker')), true);
});

test('local context file reads are limited to allowed files and line ranges', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-context-read-'));
  const userDataPath = path.join(root, 'user-data');
  const allowed = path.join(root, 'vault');
  const outside = path.join(root, 'outside');
  const notePath = path.join(allowed, 'Project.md');

  fs.mkdirSync(allowed, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(notePath, ['# Project', 'one', 'two', 'three', 'four'].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(outside, 'Secret.md'), 'secret', 'utf-8');

  const read = readLocalContextFile({
    userDataPath,
    allowedFolders: [allowed],
    filePath: notePath,
    line: 3,
    before: 1,
    after: 1,
  });
  assert.equal(read.ok, true);
  assert.equal(read.startLine, 2);
  assert.equal(read.endLine, 4);
  assert.match(read.snippet, /one\ntwo\nthree/);

  const blocked = readLocalContextFile({
    userDataPath,
    allowedFolders: [allowed],
    filePath: path.join(outside, 'Secret.md'),
  });
  assert.equal(blocked.ok, false);
});

test('assistant memory requires proposal before approved append', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-memory-'));
  const proposal = proposeMemoryEntry(root, {
    content: 'Prefers quick spoken confirmations.',
    reason: 'voice tone',
  });

  assert.ok(proposal.id);
  const applied = applyMemoryEntry(root, { proposalId: proposal.id });
  const docs = readAssistantDocs(root);

  assert.equal(applied.ok, true);
  assert.match(docs.memory, /Prefers quick spoken confirmations/);
});

test('safeStorage async result object unwraps into the API key string', () => {
  assert.equal(normalizeApiKey({ shouldReEncrypt: false, result: '  sk-proj-test  ' }), 'sk-proj-test');
  assert.equal(normalizeApiKey(Buffer.from('Bearer sk-proj-buffer', 'utf-8')), 'sk-proj-buffer');
});

test('voice request classifier separates action, context, and inferred draft intents', () => {
  assert.equal(classifyVoiceRequest('Armor Broker nedir diye detaylı bak').mode, 'context');
  assert.equal(classifyVoiceRequest('Sompo testlerini task olarak çıkar').mode, 'draft');
  assert.equal(classifyVoiceRequest('Yeni task ekle: bankayı ara').mode, 'action');
  assert.equal(classifyVoiceRequest('Üç taskı toplu sil').requiresApproval, true);
});

test('pending task drafts can be created, updated, selected, converted, and discarded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-drafts-'));
  const draft = createTaskDraft(root, {
    title: 'Armor Broker',
    reason: 'context findings',
    tasks: [
      { text: 'Review Armor Broker routing model', priority: true },
      { text: 'Draft follow-up questions', note: 'Ask about departments' },
    ],
  });

  assert.equal(readTaskDrafts(root).length, 1);
  const updated = updateTaskDraft(root, {
    draftId: draft.id,
    removeTaskIds: [draft.tasks[1].id],
  });
  assert.equal(updated.tasks.length, 1);

  const selection = getDraftSelection(root, { draftId: draft.id });
  const actions = draftTasksToBoardActions(selection.tasks);
  assert.equal(actions[0].type, 'create_task');
  assert.equal(actions[0].text, 'Review Armor Broker routing model');

  const applied = markDraftApplied(root, { draftId: draft.id });
  assert.equal(applied.appliedTaskCount, 1);
  assert.equal(readTaskDrafts(root).length, 0);

  createTaskDraft(root, { tasks: [{ text: 'Temporary task' }] });
  assert.equal(discardTaskDraft(root, {}).remainingCount, 0);
});

test('voice session summary and runtime context include recent events and spoken handles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whiteboard-runtime-'));
  const summary = updateVoiceSessionSummary(root, { summary: 'Currently discussing Armor Broker tasks.' });
  assert.match(summary.summary, /Armor Broker/);

  recordVoiceSessionEvent(root, { type: 'context', summary: 'Searched Armor Broker docs.' });
  const transaction = {
    id: 'txn-1',
    createdAt: '2026-05-17T00:00:00.000Z',
    metadata: { summary: 'Added Armor Broker task' },
    actions: [{ type: 'create_task' }],
    before: { tasks: [] },
    after: { tasks: [{ id: 'task-a', text: 'Review Armor Broker', priority: true }] },
  };
  const runtime = buildVoiceRuntimeContext({
    userDataPath: root,
    board: { tasks: transaction.after.tasks },
    transactions: [transaction],
  });

  assert.match(runtime.session.summary, /Armor Broker/);
  assert.deepEqual(runtime.lastCreatedTaskIds, ['task-a']);
  assert.equal(runtime.taskHandles[0].handle, '1');
  assert.equal(runtime.taskHandles[0].recent, true);
});

test('board action model output stays compact while preserving transaction metadata', () => {
  const compact = summarizeBoardActionResult({
    ok: true,
    results: [{ type: 'create_task', ids: ['task-a', 'task-b'] }],
    transactionId: 'txn-1',
    undoAvailable: true,
  });

  assert.equal(compact.ok, true);
  assert.equal(compact.transactionId, 'txn-1');
  assert.deepEqual(compact.targetIds, ['task-a', 'task-b']);
  assert.equal(Object.prototype.hasOwnProperty.call(compact, 'board'), false);
});
