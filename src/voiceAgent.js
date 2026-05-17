const MAX_SESSION_AGE_MS = 55 * 60 * 1000;
const ICE_GATHER_TIMEOUT_MS = 2500;

function asJson(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

function getOutputText(item) {
  if (!item?.content) return '';
  return item.content
    .filter(part => part.type === 'output_text' || part.type === 'output_audio_transcript')
    .map(part => part.text || part.transcript || '')
    .join('');
}

function compactTasks(tasks = []) {
  return tasks.slice(0, 80).map(task => ({
    handle: String((tasks || []).indexOf(task) + 1),
    id: task.id,
    text: task.text,
    checked: Boolean(task.checked),
    priority: Boolean(task.priority),
    category: task.category || null,
    note: task.note || null,
    x: Math.round(task.x || 0),
    y: Math.round(task.y || 0),
    external: Boolean(task.external),
    source: task.source?.displayPath || null,
  }));
}

async function waitForIceGathering(peerConnection, timeoutMs = ICE_GATHER_TIMEOUT_MS) {
  if (!peerConnection || peerConnection.iceGatheringState === 'complete') return;

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const handleStateChange = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        clearTimeout(timer);
        peerConnection.removeEventListener('icegatheringstatechange', handleStateChange);
        resolve();
      }
    };
    peerConnection.addEventListener('icegatheringstatechange', handleStateChange);
  });
}

export function createVoiceBoardSnapshot(board = {}, syncInfo = null) {
  const tasks = compactTasks(board.tasks || []);
  return {
    tasks,
    taskHandles: tasks.slice(0, 30).map(task => ({
      handle: task.handle,
      id: task.id,
      text: task.text,
      priority: task.priority,
      checked: task.checked,
    })),
    labels: (board.labels || []).slice(0, 80).map(label => ({
      id: label.id,
      text: label.text,
      x: Math.round(label.x || 0),
      y: Math.round(label.y || 0),
      color: label.color || null,
    })),
    categories: (board.categories || []).map(category => ({
      id: category.id,
      name: category.name,
      color: category.color,
    })),
    areas: (board.areas || []).slice(0, 40).map(area => ({
      id: area.id,
      x: Math.round(area.x || 0),
      y: Math.round(area.y || 0),
      width: Math.round(area.width || 0),
      height: Math.round(area.height || 0),
      color: area.color || null,
      locked: Boolean(area.locked),
    })),
    sync: syncInfo ? {
      enabled: Boolean(syncInfo.enabled),
      externalTaskCount: syncInfo.externalTaskCount || 0,
      folders: syncInfo.folders || [],
    } : null,
  };
}

export class RealtimeVoiceController {
  constructor({
    voiceApi,
    getBoardSnapshot,
    onStatus,
    onTranscript,
    onToolResult,
    onError,
  }) {
    this.voiceApi = voiceApi;
    this.getBoardSnapshot = getBoardSnapshot;
    this.onStatus = onStatus;
    this.onTranscript = onTranscript;
    this.onToolResult = onToolResult;
    this.onError = onError;
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.audioElement = null;
    this.connectedAt = 0;
    this.connecting = null;
    this.listening = false;
    this.closed = false;
    this.pendingToolCall = false;
    this.partialAssistantText = '';
  }

  setStatus(status, detail = null) {
    this.onStatus?.(status, detail);
  }

  emitTranscript(role, text, partial = false) {
    if (!text) return;
    this.onTranscript?.({
      role,
      text,
      partial,
      at: new Date().toISOString(),
    });
  }

  emitError(error) {
    const message = error?.message || String(error || 'Voice failed');
    this.setStatus('error', message);
    this.onError?.(message);
  }

  isDataChannelOpen() {
    return this.dc?.readyState === 'open';
  }

  isSessionFresh() {
    return this.pc && this.isDataChannelOpen() && Date.now() - this.connectedAt < MAX_SESSION_AGE_MS;
  }

  async ensureConnected() {
    if (this.isSessionFresh()) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.connect();
    try {
      await this.connecting;
    } catch (error) {
      this.closeConnection(false);
      throw error;
    } finally {
      this.connecting = null;
    }
  }

  async connect() {
    this.closeConnection(false);
    this.closed = false;
    this.setStatus('connecting');

    let pc = null;
    let stream = null;
    let audioElement = null;

    try {
      pc = new RTCPeerConnection();
      const dc = pc.createDataChannel('oai-events');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = false;
        pc.addTrack(track, stream);
      });

      audioElement = document.createElement('audio');
      audioElement.autoplay = true;
      audioElement.style.display = 'none';
      document.body.appendChild(audioElement);
      pc.ontrack = (event) => {
        audioElement.srcObject = event.streams[0];
      };

      dc.addEventListener('message', (event) => {
        this.handleRealtimeEvent(asJson(event.data)).catch(error => this.emitError(error));
      });

      dc.addEventListener('open', () => {
        this.setStatus(this.listening ? 'listening' : 'idle');
      });

      pc.addEventListener('connectionstatechange', () => {
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          if (!this.closed) this.setStatus('offline', pc.connectionState);
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      const answer = await this.voiceApi.createRealtimeCall(pc.localDescription?.sdp || offer.sdp);
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp || answer });

      this.pc = pc;
      this.dc = dc;
      this.stream = stream;
      this.audioElement = audioElement;
      this.connectedAt = Date.now();
      this.setStatus('idle');
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      try {
        pc?.close();
      } catch (_) {}
      audioElement?.remove();
      throw error;
    }
  }

  send(event) {
    if (!this.isDataChannelOpen()) return false;
    this.dc.send(JSON.stringify(event));
    return true;
  }

  async startListening() {
    await this.ensureConnected();
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    this.listening = true;
    this.setStatus('listening');
    this.send({ type: 'input_audio_buffer.clear' });
  }

  async stopListening() {
    if (!this.listening) return;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    this.listening = false;
    this.setStatus('idle');
  }

  async toggleListening() {
    if (this.listening) {
      await this.stopListening();
    } else {
      await this.startListening();
    }
  }

  async handleRealtimeEvent(event) {
    if (!event?.type) return;

    if (event.type === 'error') {
      throw new Error(event.error?.message || 'Realtime API error');
    }

    if (event.type === 'response.output_audio_transcript.delta' || event.type === 'response.output_text.delta') {
      this.partialAssistantText = `${this.partialAssistantText || ''}${event.delta || ''}`;
      return;
    }

    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.emitTranscript('user', event.transcript || '', false);
      return;
    }

    if (event.type === 'response.created') {
      this.partialAssistantText = '';
      this.setStatus('thinking');
      return;
    }

    if (event.type === 'input_audio_buffer.speech_started') {
      this.setStatus('listening');
      return;
    }

    if (event.type === 'input_audio_buffer.speech_stopped') {
      this.setStatus('thinking');
      return;
    }

    if (event.type !== 'response.done') return;

    const output = event.response?.output || [];
    const functionCalls = output.filter(item => item.type === 'function_call');
    const messageText = output
      .filter(item => item.type === 'message')
      .map(getOutputText)
      .join(' ')
      .trim() || (this.partialAssistantText || '').trim();

    if (functionCalls.length) {
      this.pendingToolCall = true;
      this.setStatus('acting');
      for (const call of functionCalls) {
        await this.handleFunctionCall(call);
      }
      this.pendingToolCall = false;
      this.partialAssistantText = '';
      return;
    }

    if (messageText) this.emitTranscript('assistant', messageText, false);
    this.partialAssistantText = '';
    this.setStatus(this.listening ? 'listening' : 'idle');
  }

  async handleFunctionCall(call) {
    const args = asJson(call.arguments) || {};
    this.setStatus(this.statusForTool(call.name));
    const output = await this.executeTool(call.name, args);
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(output?.modelOutput || output),
      },
    });

    if (call.name !== 'wait_for_user') {
      this.send({ type: 'response.create' });
    } else {
      this.setStatus(this.listening ? 'listening' : 'idle');
    }
  }

  async executeTool(name, args) {
    switch (name) {
      case 'classify_voice_request':
        return this.voiceApi.classifyRequest(args.utterance || '');
      case 'get_voice_runtime_context':
        return this.voiceApi.getRuntimeContext();
      case 'get_board_snapshot':
        return this.getBoardSnapshot();
      case 'execute_board_actions': {
        const result = await this.voiceApi.executeBoardActions(args.actions || [], {
          summary: args.summary || null,
          source: 'realtime',
        });
        this.onToolResult?.(name, result);
        return result;
      }
      case 'undo_last_board_action': {
        const result = await this.voiceApi.undoLastAction();
        this.onToolResult?.(name, result);
        return result;
      }
      case 'search_local_context':
        return this.voiceApi.searchContext(args.query, {
          queries: args.queries,
          maxResults: args.maxResults,
          depth: args.depth,
        });
      case 'read_local_context_file':
        return this.voiceApi.readContextFile({
          filePath: args.filePath,
          line: args.line,
          before: args.before,
          after: args.after,
        });
      case 'propose_task_draft': {
        const result = await this.voiceApi.proposeTaskDraft(args);
        this.onToolResult?.(name, result);
        return {
          ...result,
          modelOutput: {
            ok: result.ok,
            draftId: result.draft?.id,
            taskCount: result.draft?.tasks?.length || 0,
            tasks: (result.draft?.tasks || []).map(task => ({ id: task.id, text: task.text })),
            summary: result.summary,
          },
        };
      }
      case 'list_task_drafts':
        return this.voiceApi.listTaskDrafts();
      case 'update_task_draft': {
        const result = await this.voiceApi.updateTaskDraft(args);
        this.onToolResult?.(name, result);
        return {
          ...result,
          modelOutput: {
            ok: result.ok,
            draftId: result.draft?.id,
            taskCount: result.draft?.tasks?.length || 0,
            tasks: (result.draft?.tasks || []).map(task => ({ id: task.id, text: task.text })),
            summary: result.summary,
          },
        };
      }
      case 'discard_task_draft': {
        const result = await this.voiceApi.discardTaskDraft(args);
        this.onToolResult?.(name, result);
        return result;
      }
      case 'apply_task_draft': {
        const result = await this.voiceApi.applyTaskDraft(args);
        this.onToolResult?.(name, result);
        return result;
      }
      case 'request_folder_access':
        return this.voiceApi.requestFolderAccess(args.reason || 'Voice assistant context');
      case 'propose_memory_entry':
        return this.voiceApi.proposeMemoryEntry({
          content: args.content,
          reason: args.reason,
        });
      case 'update_session_summary':
        return this.voiceApi.updateSessionSummary({
          summary: args.summary,
          append: args.append,
        });
      case 'wait_for_user':
        return { ok: true, silent: true };
      default:
        return { ok: false, error: `Unsupported tool: ${name}` };
    }
  }

  statusForTool(name) {
    if (['search_local_context', 'read_local_context_file'].includes(name)) return 'searching';
    if (['propose_task_draft', 'list_task_drafts', 'update_task_draft', 'discard_task_draft'].includes(name)) return 'draft';
    if (['execute_board_actions', 'undo_last_board_action', 'apply_task_draft'].includes(name)) return 'acting';
    return 'thinking';
  }

  closeConnection(updateStatus = true) {
    this.closed = true;
    this.listening = false;
    try {
      this.stream?.getTracks().forEach(track => track.stop());
      this.pc?.close();
      this.audioElement?.remove();
    } catch (_) {}
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.audioElement = null;
    this.connectedAt = 0;
    this.pendingToolCall = false;
    this.partialAssistantText = '';
    if (updateStatus) this.setStatus('offline');
  }
}
