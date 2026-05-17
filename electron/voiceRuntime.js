import path from 'node:path';
import {
  ensureDir,
  readJson,
  writeJson,
} from './assistantContext.js';

const DRAFTS_FILE = 'voice-task-drafts.json';
const SESSION_FILE = 'voice-session-summary.json';
const MAX_DRAFTS = 20;
const MAX_DRAFT_TASKS = 40;
const MAX_SESSION_EVENTS = 40;
const MAX_RECENT_TRANSACTIONS = 8;
const MAX_TASK_HANDLES = 30;

function voicePath(userDataPath, fileName) {
  return path.join(userDataPath, fileName);
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cleanText(value) {
  return String(value || '').trim();
}

function arrayFrom(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeDraftTask(task = {}, index = 0) {
  const text = cleanText(task.text || task.title || task.name);
  if (!text) throw new Error(`Draft task text is required at index ${index + 1}`);

  return {
    id: task.id || makeId('draft-task'),
    text,
    note: cleanText(task.note) || null,
    category: task.category ?? task.categoryId ?? null,
    priority: Boolean(task.priority),
    checked: Boolean(task.checked),
    x: Number.isFinite(task.x) ? task.x : undefined,
    y: Number.isFinite(task.y) ? task.y : undefined,
  };
}

export function classifyVoiceRequest(input = '') {
  const text = cleanText(input).toLocaleLowerCase('tr-TR');
  const hasAny = words => words.some(word => text.includes(word));
  const contextPattern = hasAny(['nedir', 'neydi', 'kimdir', 'anlat', 'açıkla', 'acikla', 'bağlam', 'baglam', 'araştır', 'arastir', 'bak', 'incele', 'özetle', 'ozetle', 'hakkında', 'hakkinda']);
  const draftPattern = hasAny(['task çıkar', 'task cikar', 'task olarak', 'görev çıkar', 'gorev cikar', 'yapılacakları çıkar', 'yapilacaklari cikar', 'çıkar', 'cikar', 'toplu', 'öner', 'oner', 'bunlardan', 'notlardan', 'contextten', 'bağlamdan', 'baglamdan']);
  const actionPattern = hasAny(['ekle', 'oluştur', 'olustur', 'sil', 'taşı', 'tasi', 'güncelle', 'guncelle', 'değiştir', 'degistir', 'tamamla', 'priority', 'öncelik', 'oncelik', 'label', 'kategori', 'not ekle']);
  const destructivePattern = hasAny(['sil', 'temizle', 'hepsini', 'toplu sil', 'delete', 'remove']);

  if (draftPattern) {
    return {
      mode: 'draft',
      requiresApproval: true,
      needsContext: contextPattern,
      reason: 'The request asks to infer or bulk-create tasks from context.',
    };
  }

  if (actionPattern && !contextPattern) {
    return {
      mode: 'action',
      requiresApproval: destructivePattern,
      needsContext: false,
      reason: destructivePattern
        ? 'Direct destructive board command.'
        : 'Direct board command.',
    };
  }

  if (contextPattern) {
    return {
      mode: 'context',
      requiresApproval: false,
      needsContext: true,
      reason: 'The request asks for explanation or local context.',
    };
  }

  return {
    mode: 'ambiguous',
    requiresApproval: false,
    needsContext: false,
    reason: 'No clear board action or context question was detected.',
  };
}

export function readTaskDrafts(userDataPath) {
  return readJson(voicePath(userDataPath, DRAFTS_FILE), [])
    .filter(draft => draft?.status !== 'discarded' && draft?.status !== 'applied');
}

function writeTaskDrafts(userDataPath, drafts) {
  ensureDir(userDataPath);
  writeJson(voicePath(userDataPath, DRAFTS_FILE), drafts.slice(-MAX_DRAFTS));
}

export function createTaskDraft(userDataPath, input = {}) {
  const rawTasks = Array.isArray(input.tasks) ? input.tasks : [];
  if (!rawTasks.length) throw new Error('At least one draft task is required');

  const draft = {
    id: input.id || makeId('draft'),
    status: 'pending',
    title: cleanText(input.title) || null,
    reason: cleanText(input.reason) || null,
    source: cleanText(input.source) || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    tasks: rawTasks.slice(0, MAX_DRAFT_TASKS).map(normalizeDraftTask),
  };

  const drafts = [...readTaskDrafts(userDataPath), draft];
  writeTaskDrafts(userDataPath, drafts);
  return draft;
}

export function updateTaskDraft(userDataPath, input = {}) {
  const draftId = cleanText(input.draftId || input.id);
  if (!draftId) throw new Error('Draft id is required');

  const drafts = readTaskDrafts(userDataPath);
  const index = drafts.findIndex(draft => draft.id === draftId);
  if (index < 0) throw new Error(`Draft not found: ${draftId}`);

  const draft = drafts[index];
  const removeIds = new Set(arrayFrom(input.removeTaskIds || input.removeIds).map(cleanText));
  let tasks = draft.tasks.filter(task => !removeIds.has(task.id));

  if (Array.isArray(input.tasks)) {
    tasks = input.tasks.map(normalizeDraftTask);
  }

  if (input.patch && typeof input.patch === 'object') {
    const patchIds = new Set(arrayFrom(input.taskIds || input.ids).map(cleanText).filter(Boolean));
    tasks = tasks.map(task => {
      if (patchIds.size && !patchIds.has(task.id)) return task;
      return normalizeDraftTask({ ...task, ...input.patch, id: task.id }, 0);
    });
  }

  if (!tasks.length) throw new Error('Draft must keep at least one task');

  const next = {
    ...draft,
    title: Object.prototype.hasOwnProperty.call(input, 'title') ? cleanText(input.title) || null : draft.title,
    reason: Object.prototype.hasOwnProperty.call(input, 'reason') ? cleanText(input.reason) || null : draft.reason,
    updatedAt: nowIso(),
    tasks,
  };
  drafts[index] = next;
  writeTaskDrafts(userDataPath, drafts);
  return next;
}

export function discardTaskDraft(userDataPath, input = {}) {
  const draftId = cleanText(input.draftId || input.id);
  const drafts = readTaskDrafts(userDataPath);
  const remaining = draftId ? drafts.filter(draft => draft.id !== draftId) : [];
  writeTaskDrafts(userDataPath, remaining);
  return {
    ok: true,
    discardedDraftId: draftId || null,
    remainingCount: remaining.length,
  };
}

export function getDraftSelection(userDataPath, input = {}) {
  const drafts = readTaskDrafts(userDataPath);
  const draftId = cleanText(input.draftId || input.id || drafts.at(-1)?.id);
  if (!draftId) throw new Error('Draft id is required');
  const draft = drafts.find(candidate => candidate.id === draftId);
  if (!draft) throw new Error(`Draft not found: ${draftId}`);

  const requestedIds = new Set(arrayFrom(input.taskIds || input.ids).map(cleanText).filter(Boolean));
  const tasks = requestedIds.size
    ? draft.tasks.filter(task => requestedIds.has(task.id))
    : draft.tasks;
  if (!tasks.length) throw new Error('No draft tasks selected');

  return { draft, tasks };
}

export function markDraftApplied(userDataPath, input = {}) {
  const draftId = cleanText(input.draftId || input.id);
  const appliedIds = new Set(arrayFrom(input.taskIds || input.ids).map(cleanText).filter(Boolean));
  const drafts = readTaskDrafts(userDataPath);
  const draft = drafts.find(candidate => candidate.id === draftId);
  const remaining = drafts.flatMap(candidate => {
    if (candidate.id !== draftId) return [candidate];
    const remainingTasks = appliedIds.size
      ? candidate.tasks.filter(task => !appliedIds.has(task.id))
      : [];
    return remainingTasks.length ? [{ ...candidate, tasks: remainingTasks, updatedAt: nowIso() }] : [];
  });
  writeTaskDrafts(userDataPath, remaining);
  return {
    ok: true,
    appliedDraftId: draftId,
    appliedTaskCount: draft ? (appliedIds.size || draft.tasks.length) : 0,
    remainingCount: remaining.length,
  };
}

export function draftTasksToBoardActions(tasks = []) {
  return tasks.map(task => ({
    type: 'create_task',
    text: task.text,
    note: task.note,
    category: task.category,
    priority: task.priority,
    checked: task.checked,
    ...(Number.isFinite(task.x) ? { x: task.x } : {}),
    ...(Number.isFinite(task.y) ? { y: task.y } : {}),
  }));
}

export function readVoiceSessionState(userDataPath) {
  return {
    version: 1,
    summary: '',
    events: [],
    ...readJson(voicePath(userDataPath, SESSION_FILE), {}),
  };
}

function writeVoiceSessionState(userDataPath, state) {
  ensureDir(userDataPath);
  writeJson(voicePath(userDataPath, SESSION_FILE), {
    version: 1,
    summary: cleanText(state.summary).slice(0, 2400),
    updatedAt: state.updatedAt || nowIso(),
    events: (state.events || []).slice(-MAX_SESSION_EVENTS),
  });
}

export function recordVoiceSessionEvent(userDataPath, event = {}) {
  const state = readVoiceSessionState(userDataPath);
  const nextEvent = {
    type: cleanText(event.type) || 'event',
    summary: cleanText(event.summary).slice(0, 500),
    at: event.at || nowIso(),
  };
  if (!nextEvent.summary) return state;
  const next = {
    ...state,
    updatedAt: nowIso(),
    events: [...(state.events || []), nextEvent].slice(-MAX_SESSION_EVENTS),
  };
  writeVoiceSessionState(userDataPath, next);
  return next;
}

export function updateVoiceSessionSummary(userDataPath, input = {}) {
  const state = readVoiceSessionState(userDataPath);
  const content = cleanText(input.summary || input.content);
  if (!content) throw new Error('Session summary is required');
  const next = {
    ...state,
    summary: input.append ? [state.summary, content].filter(Boolean).join('\n').slice(-2400) : content.slice(0, 2400),
    updatedAt: nowIso(),
  };
  writeVoiceSessionState(userDataPath, next);
  return next;
}

export function compactVoiceSessionContext(userDataPath) {
  const state = readVoiceSessionState(userDataPath);
  const events = (state.events || []).slice(-8);
  return {
    summary: cleanText(state.summary),
    recentEvents: events,
  };
}

function diffTasks(before = [], after = []) {
  const beforeMap = new Map(before.map(task => [task.id, task]));
  const afterMap = new Map(after.map(task => [task.id, task]));
  const created = after.filter(task => !beforeMap.has(task.id));
  const deleted = before.filter(task => !afterMap.has(task.id));
  const updated = after.filter(task => {
    const previous = beforeMap.get(task.id);
    return previous && JSON.stringify(previous) !== JSON.stringify(task);
  });
  return { created, deleted, updated };
}

export function summarizeTransaction(transaction = {}) {
  const { created, deleted, updated } = diffTasks(transaction.before?.tasks || [], transaction.after?.tasks || []);
  const actionTypes = (transaction.actions || []).map(action => action?.type || action?.kind).filter(Boolean);
  return {
    id: transaction.id,
    createdAt: transaction.createdAt,
    summary: transaction.metadata?.summary || [
      created.length ? `${created.length} created` : '',
      updated.length ? `${updated.length} updated` : '',
      deleted.length ? `${deleted.length} deleted` : '',
    ].filter(Boolean).join(', ') || actionTypes.join(', ') || 'board action',
    actionTypes,
    createdTaskIds: created.map(task => task.id),
    updatedTaskIds: updated.map(task => task.id),
    deletedTaskIds: deleted.map(task => task.id),
  };
}

export function summarizeBoardActionResult(result = {}) {
  const results = Array.isArray(result.results) ? result.results : [];
  const ids = [...new Set(results.flatMap(item => item.ids || []))];
  const actionTypes = [...new Set(results.map(item => item.type).filter(Boolean))];
  return {
    ok: Boolean(result.ok),
    summary: result.summary || [
      actionTypes.length ? actionTypes.join(', ') : 'board action',
      ids.length ? `${ids.length} target(s)` : '',
    ].filter(Boolean).join(': '),
    transactionId: result.transactionId || null,
    undoneTransactionId: result.undoneTransactionId || null,
    targetIds: ids.slice(0, 20),
    undoAvailable: Boolean(result.undoAvailable),
    warnings: result.warnings || [],
  };
}

function taskHandle(task, index, recentIds = new Set()) {
  return {
    handle: String(index + 1),
    id: task.id,
    text: task.text,
    checked: Boolean(task.checked),
    priority: Boolean(task.priority),
    category: task.category || null,
    recent: recentIds.has(task.id),
  };
}

export function buildVoiceRuntimeContext({
  userDataPath,
  board = {},
  transactions = [],
} = {}) {
  const recentTransactions = transactions
    .slice(-MAX_RECENT_TRANSACTIONS)
    .reverse()
    .map(summarizeTransaction);
  const recentIds = new Set(recentTransactions.flatMap(item => [
    ...item.createdTaskIds,
    ...item.updatedTaskIds,
  ]));
  const taskHandles = (board.tasks || [])
    .slice(0, MAX_TASK_HANDLES)
    .map((task, index) => taskHandle(task, index, recentIds));

  return {
    session: compactVoiceSessionContext(userDataPath),
    pendingDrafts: readTaskDrafts(userDataPath).map(draft => ({
      id: draft.id,
      title: draft.title,
      reason: draft.reason,
      taskCount: draft.tasks.length,
      tasks: draft.tasks.slice(0, 12).map(task => ({
        id: task.id,
        text: task.text,
        priority: task.priority,
        category: task.category,
      })),
    })),
    recentTransactions,
    lastCreatedTaskIds: recentTransactions.flatMap(item => item.createdTaskIds).slice(0, 10),
    taskHandles,
  };
}
