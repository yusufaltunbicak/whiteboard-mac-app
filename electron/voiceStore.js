import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dialog, globalShortcut, safeStorage } from 'electron';
import { applyBoardActions, isBoardMutationAction } from '../src/boardActions.js';
import {
  applyMemoryEntry,
  ensureAssistantDocs,
  ensureDir,
  proposeMemoryEntry,
  readAssistantDocs,
  readLocalContextFile,
  readJson,
  readVoiceSettings,
  sanitizeVoiceSettings,
  searchLocalContext,
  writeJson,
  writeVoiceSettings,
} from './assistantContext.js';
import { assertApiKeyShape, unwrapSafeStorageValue } from './voiceKey.js';
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
} from './voiceRuntime.js';

const API_KEY_FILE = 'openai-api-key.json';
const TRANSACTIONS_FILE = 'voice-transactions.json';
const MAX_TRANSACTIONS = 20;
const REALTIME_BOOTSTRAP_TIMEOUT_MS = 20000;

const REALTIME_TOOLS = [
  {
    type: 'function',
    name: 'get_board_snapshot',
    description: 'Read the current whiteboard tasks, labels, areas, categories, sync status, and spoken task handles.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'function',
    name: 'classify_voice_request',
    description: 'Classify the latest user request as action, context, draft, or ambiguous before choosing the next tool path.',
    parameters: {
      type: 'object',
      properties: {
        utterance: { type: 'string' },
      },
      required: ['utterance'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_voice_runtime_context',
    description: 'Read compact voice runtime context: rolling session summary, pending drafts, recent voice transactions, last-created task ids, and spoken task handles.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'function',
    name: 'execute_board_actions',
    description: 'Apply one or more validated board actions. Use only for clear user commands, not inferred suggestions.',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'BoardAction objects such as create_task, update_task, delete_tasks, move_tasks, create_label, update_area, create_category.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
            },
            required: ['type'],
            additionalProperties: true,
          },
        },
        summary: { type: 'string' },
      },
      required: ['actions'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'propose_task_draft',
    description: 'Create a pending draft of inferred or bulk tasks. This does not mutate the board and must be used before applying inferred/context-derived tasks.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        reason: { type: 'string' },
        source: { type: 'string' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              note: { type: 'string' },
              category: { type: 'string' },
              priority: { type: 'boolean' },
              checked: { type: 'boolean' },
            },
            required: ['text'],
            additionalProperties: true,
          },
        },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'list_task_drafts',
    description: 'List currently pending task drafts awaiting user approval.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'function',
    name: 'update_task_draft',
    description: 'Update a pending task draft before approval, including removing tasks or patching selected tasks.',
    parameters: {
      type: 'object',
      properties: {
        draftId: { type: 'string' },
        title: { type: 'string' },
        reason: { type: 'string' },
        taskIds: { type: 'array', items: { type: 'string' } },
        removeTaskIds: { type: 'array', items: { type: 'string' } },
        patch: {
          type: 'object',
          additionalProperties: true,
        },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
              note: { type: 'string' },
              category: { type: 'string' },
              priority: { type: 'boolean' },
              checked: { type: 'boolean' },
            },
            required: ['text'],
            additionalProperties: true,
          },
        },
      },
      required: ['draftId'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'discard_task_draft',
    description: 'Discard one pending draft, or all pending drafts if no draftId is supplied.',
    parameters: {
      type: 'object',
      properties: {
        draftId: { type: 'string' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'apply_task_draft',
    description: 'Apply approved draft tasks to the board. Use only after the user explicitly approves the draft or selected draft tasks.',
    parameters: {
      type: 'object',
      properties: {
        draftId: { type: 'string' },
        taskIds: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
      },
      required: ['draftId'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'undo_last_board_action',
    description: 'Undo the most recent voice-applied board transaction.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'function',
    name: 'search_local_context',
    description: 'Search allowed local Markdown/text context before answering user-specific, project, company, product, or "what is X" questions. Returns small snippets only, never the whole vault.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        queries: {
          type: 'array',
          description: 'Optional query variants for deeper lookup, for example spaced name, compact name, and Turkish/English aliases.',
          items: { type: 'string' },
        },
        maxResults: { type: 'number' },
        depth: {
          type: 'string',
          enum: ['quick', 'deep'],
          description: 'Use deep for explanatory/context questions and quick for narrow lookups.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'read_local_context_file',
    description: 'Read a small line range from a file returned by search_local_context. Use this after search when a context answer needs more than one snippet.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute filePath or displayPath returned by search_local_context.',
        },
        line: {
          type: 'number',
          description: 'Relevant line number from search results.',
        },
        before: { type: 'number' },
        after: { type: 'number' },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'request_folder_access',
    description: 'Ask the user to grant read-only context access to additional local folders.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'propose_memory_entry',
    description: 'Propose a durable memory entry. This does not save memory until the user approves it.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'update_session_summary',
    description: 'Update the rolling local summary for the current voice work session. Use after important context findings or multi-step task changes.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        append: { type: 'boolean' },
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'wait_for_user',
    description: 'Call when the latest audio is silence, background noise, side conversation, or does not need a spoken response.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

function keyPath(userDataPath) {
  return path.join(userDataPath, API_KEY_FILE);
}

function transactionsPath(userDataPath) {
  return path.join(userDataPath, TRANSACTIONS_FILE);
}

function readTransactions(userDataPath) {
  return readJson(transactionsPath(userDataPath), []);
}

function writeTransactions(userDataPath, transactions) {
  writeJson(transactionsPath(userDataPath), transactions.slice(-MAX_TRANSACTIONS));
}

async function encryptApiKey(apiKey) {
  if (safeStorage?.isEncryptionAvailable?.()) {
    if (typeof safeStorage.encryptStringAsync === 'function') {
      const encrypted = unwrapSafeStorageValue(await safeStorage.encryptStringAsync(apiKey));
      return { mode: 'safeStorage', value: Buffer.from(encrypted).toString('base64') };
    }

    const encrypted = safeStorage.encryptString(apiKey);
    return { mode: 'safeStorage', value: Buffer.from(encrypted).toString('base64') };
  }

  return { mode: 'plain-dev-fallback', value: Buffer.from(apiKey, 'utf-8').toString('base64') };
}

async function decryptApiKey(payload) {
  if (!payload?.value) return null;
  const buffer = Buffer.from(payload.value, 'base64');

  if (payload.mode === 'safeStorage') {
    if (typeof safeStorage.decryptStringAsync === 'function') {
      return unwrapSafeStorageValue(await safeStorage.decryptStringAsync(buffer));
    }
    return safeStorage.decryptString(buffer);
  }

  if (payload.mode === 'plain-dev-fallback') {
    return buffer.toString('utf-8');
  }

  return null;
}

function buildSafetyIdentifier(userDataPath) {
  return crypto
    .createHash('sha256')
    .update(`whiteboard-voice:${userDataPath}`)
    .digest('hex')
    .slice(0, 32);
}

function boardChanged(fromBoard, toBoard) {
  return JSON.stringify(fromBoard) !== JSON.stringify(toBoard);
}

function compactAssistantDocs(docs) {
  const limit = 6000;
  return {
    memory: String(docs.memory || '').slice(-limit),
    voice: String(docs.voice || '').slice(-limit),
    sessionSummary: String(docs.sessionSummary || '').slice(-2400),
  };
}

function buildRealtimeInstructions(docs, runtimeContext = {}) {
  const compact = compactAssistantDocs(docs);
  const runtime = JSON.stringify({
    session: runtimeContext.session,
    pendingDrafts: runtimeContext.pendingDrafts,
    recentTransactions: runtimeContext.recentTransactions,
    lastCreatedTaskIds: runtimeContext.lastCreatedTaskIds,
  }, null, 2).slice(0, 6000);
  return [
    '# Role and Objective',
    'You are the voice assistant inside Whiteboard Todos, a local Markdown-backed task board.',
    'Help the user manage tasks, labels, categories, areas, notes, priorities, and board layout through natural speech.',
    '',
    '# Language and Tone',
    compact.voice,
    '',
    '# Durable Memory',
    compact.memory,
    '',
    '# Current Voice Session Summary',
    compact.sessionSummary || 'No rolling session summary yet.',
    '',
    '# Runtime Context Snapshot',
    runtime,
    '',
    '# Action Policy',
    '- Use only the provided tools. Never invent or simulate a tool.',
    '- At the start of each non-trivial user request, use classify_voice_request or get_voice_runtime_context when it helps route the request.',
    '- For clear direct board commands, do not speak first. Your first response output must be the relevant tool call.',
    '- After a tool succeeds, summarize in past tense only, such as "Ekledim", "Taşıdım", "Güncelledim", or "Sildim".',
    '- Do not say "bakıyorum", "şimdi düzenliyorum", "yapacağım", "bir saniye", or similar progress filler after a tool has already run.',
    '- For task suggestions inferred from local context or bulk extraction, call propose_task_draft and ask for approval. Never call execute_board_actions for inferred tasks before approval.',
    '- When the user approves a pending draft, call apply_task_draft. If the user edits the proposed list, call update_task_draft first.',
    '- Use get_voice_runtime_context to resolve "az önceki task", "son eklediğin", task numbers, and pending draft references.',
    '- External synced task source text is read-only in v1. You may update board overlays like priority, note, category, checked state, and position.',
    '- For destructive or bulk actions, act when the command is clear, then mention that undo is available.',
    '- If an identifier, target task, or intended action is ambiguous, ask one short clarifying question.',
    '- Keep spoken replies brief. Prefer one short sentence after actions.',
    '- Only say an action is complete after the relevant tool call succeeds.',
    '',
    '# Local Context',
    '- For user-specific, company, product, repo, vault, project, person, customer, or "what is X" questions, gather local context before answering. Do not answer from general model knowledge first.',
    '- For context questions, first call get_board_snapshot if board state may matter, then call search_local_context. Use depth="deep" and 2-4 query variants when the name may appear with spaces, hyphens, or camel case.',
    '- If search results look relevant, call read_local_context_file for the top 1-3 files/lines before giving a substantive answer.',
    '- If search_local_context returns no or weak matches, say you could not find enough in the allowed local context and ask whether to request folder access. Do not bluff.',
    '- When answering from snippets, say briefly which files or folders the answer came from. Keep spoken answers concise, but not rushed.',
    '- If more context is needed, call request_folder_access with a short reason.',
    '- Do not expose long file contents; work from returned snippets.',
    '',
    '# Silence and Background Audio',
    '- If the latest audio is not addressed to you, call wait_for_user.',
  ].join('\n');
}

function buildRealtimeSession(settings, docs, runtimeContext) {
  return {
    type: 'realtime',
    model: settings.model,
    reasoning: {
      effort: settings.reasoningEffort,
    },
    audio: {
      input: {
        turn_detection: {
          type: 'server_vad',
        },
      },
      output: {
        voice: settings.voice,
      },
    },
    instructions: buildRealtimeInstructions(docs, runtimeContext),
    tools: REALTIME_TOOLS,
    tool_choice: 'auto',
  };
}

export class VoiceStore {
  constructor({ userDataPath, boardStore, getWindow }) {
    this.userDataPath = userDataPath;
    this.boardStore = boardStore;
    this.getWindow = getWindow;
    this.settings = readVoiceSettings(userDataPath);
    this.registeredShortcut = null;
    this.shortcutRegistered = false;
  }

  initialize() {
    ensureDir(this.userDataPath);
    ensureAssistantDocs(this.userDataPath);
    writeVoiceSettings(this.userDataPath, this.settings);
    this.registerShortcut();
  }

  close() {
    this.unregisterShortcut();
  }

  send(channel, payload) {
    const target = this.getWindow()?.webContents;
    if (target && !target.isDestroyed()) {
      target.send(`voice:${channel}`, payload);
    }
  }

  async hasApiKey() {
    if (process.env.OPENAI_API_KEY) return true;
    return fs.existsSync(keyPath(this.userDataPath));
  }

  async setApiKey(apiKey) {
    const clean = assertApiKeyShape(apiKey);
    const encrypted = await encryptApiKey(clean);
    writeJson(keyPath(this.userDataPath), encrypted);
    this.send('settings-changed', await this.getSettings());
    return { ok: true };
  }

  clearApiKey() {
    try {
      fs.rmSync(keyPath(this.userDataPath), { force: true });
    } catch (_) {}
    this.send('settings-changed', {
      ...this.getSettingsSync(),
      hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    });
    return { ok: true };
  }

  async getApiKey() {
    if (process.env.OPENAI_API_KEY) return assertApiKeyShape(process.env.OPENAI_API_KEY);
    const payload = readJson(keyPath(this.userDataPath), null);
    const apiKey = await decryptApiKey(payload);
    return assertApiKeyShape(apiKey);
  }

  getSettingsSync() {
    return {
      ...this.settings,
      shortcutRegistered: this.shortcutRegistered,
      docs: ensureAssistantDocs(this.userDataPath),
    };
  }

  async getSettings() {
    return {
      ...this.getSettingsSync(),
      hasApiKey: await this.hasApiKey(),
    };
  }

  updateSettings(patch = {}) {
    const previousShortcut = this.settings.shortcut;
    this.settings = writeVoiceSettings(this.userDataPath, sanitizeVoiceSettings({
      ...this.settings,
      ...patch,
    }));

    if (previousShortcut !== this.settings.shortcut || Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
      this.registerShortcut();
    }

    const next = this.getSettingsSync();
    this.send('settings-changed', next);
    return next;
  }

  unregisterShortcut() {
    if (this.registeredShortcut) {
      try {
        globalShortcut.unregister(this.registeredShortcut);
      } catch (_) {}
    }
    this.registeredShortcut = null;
    this.shortcutRegistered = false;
  }

  registerShortcut() {
    this.unregisterShortcut();
    if (!this.settings.enabled || !this.settings.shortcut) return false;

    try {
      this.shortcutRegistered = globalShortcut.register(this.settings.shortcut, () => {
        this.send('shortcut', {
          shortcut: this.settings.shortcut,
          at: new Date().toISOString(),
        });
      });
      this.registeredShortcut = this.shortcutRegistered ? this.settings.shortcut : null;
    } catch (_) {
      this.shortcutRegistered = false;
      this.registeredShortcut = null;
    }

    this.send('settings-changed', this.getSettingsSync());
    return this.shortcutRegistered;
  }

  async createRealtimeCall(localSdp) {
    const apiKey = await this.getApiKey();
    const runtimeContext = this.getRuntimeContext();
    const docs = {
      ...readAssistantDocs(this.userDataPath),
      sessionSummary: runtimeContext.session?.summary || '',
    };
    const session = buildRealtimeSession(this.settings, docs, runtimeContext);
    const fd = new FormData();
    fd.set('sdp', String(localSdp || ''));
    fd.set('session', JSON.stringify(session));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REALTIME_BOOTSTRAP_TIMEOUT_MS);

    let response;
    let sdp;
    try {
      response = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Safety-Identifier': buildSafetyIdentifier(this.userDataPath),
        },
        body: fd,
      });
      sdp = await response.text();
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('Realtime session timed out while contacting OpenAI.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`Realtime session failed (${response.status}): ${sdp.slice(0, 300)}`);
    }

    return {
      sdp,
      model: this.settings.model,
      voice: this.settings.voice,
      createdAt: new Date().toISOString(),
    };
  }

  endRealtimeSession() {
    return { ok: true };
  }

  executeBoardActions(actions, metadata = {}) {
    const list = Array.isArray(actions) ? actions : [];
    const mutatingActions = list.filter(isBoardMutationAction);
    const refreshOnly = list.length > 0 && mutatingActions.length === 0;

    if (refreshOnly) {
      const result = {
        ok: true,
        board: this.boardStore.readBoard(),
        results: list.map(action => ({ type: action?.type || action?.kind, skipped: true })),
        undoAvailable: readTransactions(this.userDataPath).length > 0,
      };
      result.modelOutput = summarizeBoardActionResult(result);
      recordVoiceSessionEvent(this.userDataPath, {
        type: 'board-refresh',
        summary: result.modelOutput.summary,
      });
      return {
        ...result,
      };
    }

    const before = this.boardStore.readBoard();
    const applied = applyBoardActions(before, mutatingActions, {
      genId: prefix => `${prefix}${crypto.randomBytes(4).toString('hex')}`,
    });

    if (!boardChanged(before, applied.board)) {
      const result = {
        ok: true,
        board: before,
        results: applied.results,
        undoAvailable: readTransactions(this.userDataPath).length > 0,
      };
      result.modelOutput = summarizeBoardActionResult(result);
      return result;
    }

    const writeResult = this.boardStore.writeBoard(applied.board);
    const transaction = {
      id: `txn-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      createdAt: new Date().toISOString(),
      metadata: {
        source: 'voice',
        ...metadata,
      },
      actions: mutatingActions,
      before,
      after: writeResult.board,
    };
    writeTransactions(this.userDataPath, [...readTransactions(this.userDataPath), transaction]);

    const result = {
      ok: writeResult.ok,
      warnings: writeResult.warnings || [],
      board: writeResult.board,
      results: applied.results,
      transactionId: transaction.id,
      undoAvailable: true,
    };
    result.modelOutput = summarizeBoardActionResult({
      ...result,
      summary: transaction.metadata.summary,
    });
    recordVoiceSessionEvent(this.userDataPath, {
      type: 'board-action',
      summary: result.modelOutput.summary,
    });
    return result;
  }

  undoLastAction() {
    const transactions = readTransactions(this.userDataPath);
    const transaction = transactions.pop();
    if (!transaction) {
      return {
        ok: false,
        message: 'No voice action to undo',
        board: this.boardStore.readBoard(),
        undoAvailable: false,
      };
    }

    const writeResult = this.boardStore.writeBoard(transaction.before);
    writeTransactions(this.userDataPath, transactions);
    const result = {
      ok: writeResult.ok,
      warnings: writeResult.warnings || [],
      board: writeResult.board,
      undoneTransactionId: transaction.id,
      undoAvailable: transactions.length > 0,
    };
    result.modelOutput = summarizeBoardActionResult({
      ...result,
      summary: `undid ${transaction.metadata?.summary || transaction.actions?.map(action => action.type).join(', ') || 'last voice action'}`,
    });
    recordVoiceSessionEvent(this.userDataPath, {
      type: 'undo',
      summary: result.modelOutput.summary,
    });
    return result;
  }

  searchContext(query, options = {}) {
    const sync = this.boardStore.state?.sync || {};
    return searchLocalContext({
      userDataPath: this.userDataPath,
      boardPath: this.boardStore.boardPath,
      syncFolders: sync.enabled ? sync.folders : [],
      allowedFolders: this.settings.allowedFolders,
      query,
      queries: options.queries,
      depth: options.depth,
      maxResults: options.maxResults || (options.depth === 'deep' ? 16 : this.settings.contextMaxResults),
    });
  }

  readContextFile(input = {}) {
    const sync = this.boardStore.state?.sync || {};
    return readLocalContextFile({
      userDataPath: this.userDataPath,
      boardPath: this.boardStore.boardPath,
      syncFolders: sync.enabled ? sync.folders : [],
      allowedFolders: this.settings.allowedFolders,
      filePath: input.filePath || input.displayPath,
      line: input.line,
      before: input.before,
      after: input.after,
    });
  }

  classifyRequest(input = {}) {
    return classifyVoiceRequest(input.utterance || input.text || input);
  }

  getRuntimeContext() {
    return buildVoiceRuntimeContext({
      userDataPath: this.userDataPath,
      board: this.boardStore.readBoard(),
      transactions: readTransactions(this.userDataPath),
    });
  }

  listTaskDrafts() {
    return {
      ok: true,
      drafts: readTaskDrafts(this.userDataPath),
    };
  }

  proposeTaskDraft(input = {}) {
    const draft = createTaskDraft(this.userDataPath, input);
    recordVoiceSessionEvent(this.userDataPath, {
      type: 'draft-proposed',
      summary: `proposed ${draft.tasks.length} task draft(s)${draft.title ? ` for ${draft.title}` : ''}`,
    });
    this.send('drafts-changed', this.listTaskDrafts());
    return {
      ok: true,
      draft,
      summary: `${draft.tasks.length} task draft(s) are pending approval.`,
    };
  }

  updateTaskDraft(input = {}) {
    const draft = updateTaskDraft(this.userDataPath, input);
    recordVoiceSessionEvent(this.userDataPath, {
      type: 'draft-updated',
      summary: `updated draft ${draft.id}; ${draft.tasks.length} task(s) pending`,
    });
    this.send('drafts-changed', this.listTaskDrafts());
    return {
      ok: true,
      draft,
      summary: `Draft updated; ${draft.tasks.length} task(s) pending.`,
    };
  }

  discardTaskDraft(input = {}) {
    const result = discardTaskDraft(this.userDataPath, input);
    recordVoiceSessionEvent(this.userDataPath, {
      type: 'draft-discarded',
      summary: input?.draftId ? `discarded draft ${input.draftId}` : 'discarded all pending drafts',
    });
    this.send('drafts-changed', this.listTaskDrafts());
    return result;
  }

  applyTaskDraft(input = {}) {
    const { draft, tasks } = getDraftSelection(this.userDataPath, input);
    const actions = draftTasksToBoardActions(tasks);
    const result = this.executeBoardActions(actions, {
      source: 'voice-draft',
      summary: input.summary || `Applied ${tasks.length} approved draft task(s) from ${draft.id}`,
      draftId: draft.id,
    });
    const marked = markDraftApplied(this.userDataPath, {
      draftId: draft.id,
      taskIds: tasks.map(task => task.id),
    });
    this.send('drafts-changed', this.listTaskDrafts());
    return {
      ...result,
      appliedDraft: marked,
      modelOutput: {
        ...result.modelOutput,
        summary: `Applied ${tasks.length} approved draft task(s).`,
      },
    };
  }

  updateSessionSummary(input = {}) {
    const state = updateVoiceSessionSummary(this.userDataPath, input);
    this.send('session-summary-changed', state);
    return {
      ok: true,
      summary: state.summary,
      updatedAt: state.updatedAt,
    };
  }

  async requestFolderAccess(reason = '') {
    const result = await dialog.showOpenDialog(this.getWindow(), {
      title: reason ? `Allow voice context: ${reason}` : 'Allow voice context folders',
      properties: ['openDirectory', 'multiSelections'],
      defaultPath: this.boardStore.state?.sync?.vaultRoot,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        ok: false,
        canceled: true,
        allowedFolders: this.settings.allowedFolders,
      };
    }

    this.settings = writeVoiceSettings(this.userDataPath, {
      ...this.settings,
      allowedFolders: [...new Set([...this.settings.allowedFolders, ...result.filePaths.map(item => path.resolve(item))])],
    });
    this.send('settings-changed', this.getSettingsSync());
    return {
      ok: true,
      allowedFolders: this.settings.allowedFolders,
    };
  }

  readAssistantDocs() {
    return readAssistantDocs(this.userDataPath);
  }

  proposeMemoryEntry(proposal) {
    const next = proposeMemoryEntry(this.userDataPath, proposal);
    this.send('memory-proposed', next);
    return next;
  }

  applyMemoryEntry(input) {
    const result = applyMemoryEntry(this.userDataPath, input);
    this.send('memory-applied', result);
    return result;
  }

  buildMenuItems() {
    return [
      {
        label: 'Toggle Voice',
        accelerator: this.settings.shortcut,
        click: () => this.send('shortcut', {
          shortcut: this.settings.shortcut,
          at: new Date().toISOString(),
        }),
      },
      {
        label: this.shortcutRegistered ? `Shortcut Active (${this.settings.shortcut})` : `Shortcut Unavailable (${this.settings.shortcut})`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Voice Settings',
        click: () => this.send('open-settings', {}),
      },
      {
        label: 'Allow Context Folders...',
        click: async () => {
          await this.requestFolderAccess('Voice assistant context');
        },
      },
      { type: 'separator' },
      {
        label: 'Clear OpenAI API Key',
        click: () => this.clearApiKey(),
      },
    ];
  }
}

export function createVoiceStore(options) {
  return new VoiceStore(options);
}
