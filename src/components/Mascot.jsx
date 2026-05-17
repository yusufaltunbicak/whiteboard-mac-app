import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const moodConfigs = {
  neutral:     { eyeR: 3.5, eyeY: 48, browLift: 0,  mouth: null,       crownAnim: 'floatCrown 4s ease-in-out infinite',       eyeShift: 0 },
  curious:     { eyeR: 4.2, eyeY: 45, browLift: 6,  mouth: null,       crownAnim: 'floatCrown 3s ease-in-out infinite',       eyeShift: 3 },
  excited:     { eyeR: 4.5, eyeY: 45, browLift: 9,  mouth: 'smile',    crownAnim: 'celebrateCrown 1.8s ease-in-out infinite',  eyeShift: 0 },
  sleeping:    { eyeR: 0,   eyeY: 48, browLift: -2, mouth: null,       crownAnim: 'floatCrown 6s ease-in-out infinite',       eyeShift: 0 },
  celebrating: { eyeR: 5,   eyeY: 44, browLift: 12, mouth: 'bigSmile', crownAnim: 'celebrateCrown 1.2s ease-in-out infinite',  eyeShift: 0 },
  proud:       { eyeR: 3.5, eyeY: 47, browLift: 4,  mouth: 'smile',    crownAnim: 'floatCrown 3.5s ease-in-out infinite',     eyeShift: 0 },
  stressed:    { eyeR: 3,   eyeY: 50, browLift: -4, mouth: 'frown',    crownAnim: 'floatCrown 2s ease-in-out infinite',       eyeShift: 0 },
  focused:     { eyeR: 3.5, eyeY: 48, browLift: 2,  mouth: null,       crownAnim: 'floatCrown 3s ease-in-out infinite',       eyeShift: 1 },
  sad:         { eyeR: 3,   eyeY: 50, browLift: -5, mouth: 'frown',    crownAnim: 'floatCrown 5s ease-in-out infinite',       eyeShift: 0 },
  inspecting:  { eyeR: 4.3, eyeY: 46, browLift: 7,  mouth: 'smile',    crownAnim: 'floatCrown 2.4s ease-in-out infinite',     eyeShift: 2 },
  relocating:  { eyeR: 4,   eyeY: 46, browLift: 5,  mouth: null,       crownAnim: 'floatCrown 1.8s ease-in-out infinite',     eyeShift: 0 },
};

const phrasePools = {
  neutral: ['steady now', 'tiny empire', 'ink still wet', 'clean enough'],
  curious: ['hmm...', 'fresh ink', 'new card energy', 'what are we making'],
  excited: ['nice!', 'clean hit', 'that landed', 'solid move'],
  sleeping: ['zzz...', 'blank canvas', 'wake me with a task', 'too quiet'],
  celebrating: ['woohoo!', 'crown secured', 'board cleared', 'nailed it'],
  proud: ['looking good', 'shape is forming', 'this tracks', 'pretty neat'],
  stressed: ['eek...', 'triage time', 'many fires', 'breathe first'],
  focused: ["let's go", 'pick the hard one', 'quiet grind', 'ship the sharp bit'],
  sad: ['oh no...', 'gone now', 'ruthless', 'pour one out'],
  inspecting: ['checking this', 'hmm, this one', 'suspiciously important', 'tiny masterpiece?'],
  relocating: ['better here', 'composition pass', 'give it room', 'nudging the chaos'],
  idle: ['still plotting', 'you can zoom out, you know', 'this board has opinions', 'quiet... too quiet'],
};

const notePools = {
  neutral: ['sharp!', 'ink thinks', 'tiny critique', 'grid approves'],
  curious: ['curiosity pass', 'margin note', 'what if...', 'new line'],
  excited: ['good rhythm', 'momentum!', 'sweet stroke', 'kept that'],
  sleeping: ['standby doodle', 'soft static', 'paper nap', 'ink snooze'],
  celebrating: ['crown earned', 'victory lap', 'done-done', 'ink parade'],
  proud: ['nice silhouette', 'solid spread', 'clean flow', 'board glow'],
  stressed: ['triage sketch', 'many tabs', 'heavy stack', 'sirens, softly'],
  focused: ['focus lane', 'one card first', 'deep work', 'quiet pressure'],
  sad: ['tiny elegy', 'erased gently', 'ghost note', 'farewell scribble'],
  inspecting: ['detail pass', 'squinting...', 'audit mode', 'closer look'],
  relocating: ['layout tweak', 'weight shift', 'move study', 'space-making'],
  idle: ['ambient note', 'margin gossip', 'paper brain', 'low-stakes lore'],
};

const asidePools = {
  neutral: ['paper brain', 'soft pencil', 'still warm', 'tiny system'],
  curious: ['plot twist', 'fresh corner', 'idea dust', 'new route'],
  excited: ['good snap', 'ink pop', 'clean arc', 'yes, that'],
  sleeping: ['snore loop', 'idle ink', 'nap mode', 'dream grid'],
  celebrating: ['royal stamp', 'all green', 'lap complete', 'sparkle tax'],
  proud: ['held up', 'reads well', 'solid pass', 'nice spread'],
  stressed: ['this is fine-ish', 'hard mode', 'too many stars', 'triage hat'],
  focused: ['heads down', 'one lane', 'stay sharp', 'keep moving'],
  sad: ['tiny gasp', 'cold ink', 'gone-gone', 'a brief silence'],
  inspecting: ['pin it', 'look twice', 'maybe this', 'interesting...'],
  relocating: ['slide study', 'air traffic', 'weight balance', 'clean lane'],
  idle: ['whisper mode', 'observing...', 'I have notes', 'silent judge'],
};

const playfulCuePools = {
  'task-fidget': {
    bubblePool: ['same card again?', 'hover cardio', 'you can click it, you know', 'doing laps?'],
    annotationPool: ['fidget detected', 'cursor aerobics', 'tiny obsession'],
    asidePool: ['no judgment', 'I noticed', 'carry on'],
  },
  'mascot-pester': {
    bubblePool: ['yes yes, hello', 'boop loop detected', 'you found me again', 'hover me one more time'],
    annotationPool: ['mascot tax', 'boop audit', 'tiny gremlin'],
    asidePool: ['I can see you too', 'still here', 'this is becoming a bit'],
  },
  'zoom-in-deep': {
    bubblePool: ['close enough?', 'pixel interview', 'nose-to-paper mode', 'we are in the fibers now'],
    annotationPool: ['macro study', 'paper pores', 'magnify politely'],
    asidePool: ['the pixels feel seen', 'steady, microscope', 'no need to inhale the ink'],
  },
  'zoom-out-deep': {
    bubblePool: ['satellite mode', 'from orbit now', 'whole continent view', 'we left the room'],
    annotationPool: ['map brain', 'tiny planet', 'distance, achieved'],
    asidePool: ['the board is now weather', 'call the telescope', 'breathe, astronaut'],
  },
};

const hoverKeywordEasterEggs = {
  bug: {
    bubblePool: ['gremlin spotted', 'bug-shaped task', 'debug hat on'],
    annotationPool: ['debug doodle', 'gremlin alert', 'fixer mode'],
    asidePool: ['squash gently', 'trace first', 'no panic'],
  },
  snack: {
    bubblePool: ['snack-powered', 'fuel task detected', 'crumb protocol'],
    annotationPool: ['break note', 'caffeine arc', 'tiny refuel'],
    asidePool: ['sip first', 'eat code eat', 'mood support'],
  },
  idea: {
    bubblePool: ['idea glow', 'brainwave card', 'this has spark'],
    annotationPool: ['idea residue', 'concept ink', 'maybe big'],
    asidePool: ['do not lose', 'save this', 'worth keeping'],
  },
};

function getMood(tasks, lastAction) {
  if (lastAction === 'add') return 'curious';
  if (lastAction === 'complete') return 'excited';
  if (lastAction === 'delete') return 'sad';
  if (!tasks || tasks.length === 0) return 'sleeping';

  const total = tasks.length;
  const done = tasks.filter(task => task.checked).length;
  const prio = tasks.filter(task => task.priority && !task.checked).length;

  if (done === total && total > 0) return 'celebrating';
  if (total > 2 && done / total > 0.7) return 'proud';
  if (prio >= 3) return 'stressed';
  if (prio > 0) return 'focused';
  return 'neutral';
}

function mouthPath(type) {
  if (type === 'smile') return 'M 44 79 Q 50 83 56 79';
  if (type === 'bigSmile') return 'M 40 79 Q 50 87 60 79';
  if (type === 'frown') return 'M 44 82 Q 50 78 56 82';
  return null;
}

function nosePath() {
  return 'M 50 43 Q 46 57 44 67 Q 50 69 56 67';
}

function browPath(side, browLift) {
  const isLeft = side === 'left';
  const startX = isLeft ? 30 : 52;
  const controlX = isLeft ? 39 : 61;
  const endX = isLeft ? 47 : 70;
  const startY = 37 - (browLift * 0.85);
  const controlY = 31 - browLift;
  const endY = 36 - (browLift * 0.7);

  return `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
}

function uniquePool(...parts) {
  return [...new Set(parts.flat().filter(Boolean))];
}

function pickFromPool(pool, previous, seed) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  const start = seed % pool.length;
  for (let i = 0; i < pool.length; i += 1) {
    const candidate = pool[(start + i) % pool.length];
    if (candidate !== previous) return candidate;
  }

  return pool[start];
}

function getTaskById(tasks, id) {
  if (!id || !tasks) return null;
  return tasks.find(task => task.id === id) || null;
}

function getKeywordTag(text = '') {
  const normalized = text.toLowerCase();
  if (/bug|fix|issue|error|crash/.test(normalized)) return 'bug';
  if (/coffee|tea|lunch|break|snack/.test(normalized)) return 'snack';
  if (/idea|brainstorm|dream|vision/.test(normalized)) return 'idea';
  return null;
}

function getRelocationDelta(task, dragging) {
  if (!dragging) return { dx: 0, dy: 0 };

  return {
    dx: (task?.x ?? dragging.startX ?? 0) - (dragging.startX ?? 0),
    dy: (task?.y ?? dragging.startY ?? 0) - (dragging.startY ?? 0),
  };
}

function getDragBucket(task, dragging) {
  const { dx, dy } = getRelocationDelta(task, dragging);
  const distance = Math.hypot(dx, dy);

  if (distance < 36) return 'nudge';
  if (distance > 420) return 'yeet';
  if (distance > 260) return 'far';
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

function getRelocationEyeShift(task, dragging) {
  const { dx } = getRelocationDelta(task, dragging);
  if (Math.abs(dx) < 18) return 0;
  return dx > 0 ? 3 : -3;
}

function getBoardEasterEgg(tasks) {
  if (!tasks || tasks.length === 0) return null;

  const total = tasks.length;
  const prio = tasks.filter(task => task.priority && !task.checked).length;
  const done = tasks.filter(task => task.checked).length;

  if (total === 42) {
    return {
      id: 'answer',
      bubblePool: ['answer unlocked', '42, naturally'],
      annotationPool: ['deep lore', 'cosmic count'],
      asidePool: ['do not panic', 'towel energy'],
    };
  }

  if (prio >= 5) {
    return {
      id: 'triage',
      bubblePool: ['this is fine-ish', 'star storm'],
      annotationPool: ['triage circus', 'priority weather'],
      asidePool: ['five alarms', 'steady hands'],
    };
  }

  if (done === total && total > 0) {
    return {
      id: 'crown',
      bubblePool: ['crown secured', 'all green'],
      annotationPool: ['victory lap', 'royal stamp'],
      asidePool: ['board peace', 'glorious hush'],
    };
  }

  return null;
}

function buildHoverScene(task) {
  const keywordTag = getKeywordTag(task.text);
  const keywordEgg = keywordTag ? hoverKeywordEasterEggs[keywordTag] : null;
  const longTask = (task.text || '').trim().length > 44;

  return {
    mood: 'inspecting',
    kind: 'hover',
    signature: [
      'hover',
      task.id,
      task.priority ? 'prio' : 'normal',
      task.checked ? 'done' : 'open',
      task.note ? 'note' : 'plain',
      task.category || 'uncat',
      keywordTag || 'none',
      longTask ? 'long' : 'short',
    ].join(':'),
    bubblePool: uniquePool(
      task.priority && !task.checked ? ['urgent one', 'red-flag card'] : [],
      task.checked ? ['done deal', 'already cooked'] : [],
      task.note ? ['has notes', 'note-heavy'] : [],
      task.category ? ['mapped out', 'tagged nicely'] : [],
      longTask ? ['novel detected', 'big thought'] : [],
      keywordEgg?.bubblePool,
      phrasePools.inspecting,
    ),
    annotationPool: uniquePool(
      keywordEgg?.annotationPool,
      longTask ? ['long read', 'wide margin'] : [],
      notePools.inspecting,
    ),
    asidePool: uniquePool(
      keywordEgg?.asidePool,
      task.checked ? ['wrapped up'] : [],
      asidePools.inspecting,
    ),
    eggId: keywordTag || (longTask ? 'long-task' : null),
    eyeShift: moodConfigs.inspecting.eyeShift,
  };
}

function buildDragScene(task, dragging) {
  const bucket = getDragBucket(task, dragging);
  const yeetEgg = bucket === 'yeet'
    ? {
      bubblePool: ['elegant yeet', 'long haul move', 'quite the commute'],
      annotationPool: ['aerial route', 'distance queen', 'big transfer'],
      asidePool: ['still intentional', 'hold the line', 'no chaos, only motion'],
    }
    : null;

  const bucketPhrases = {
    nudge: ['tiny nudge', 'micro-adjust', 'almost there'],
    far: ['big move', 'new neighborhood', 'fresh breathing room'],
    yeet: ['elegant yeet', 'big swing', 'full relocation'],
    left: ['slide left', 'pull it left', 'westward'],
    right: ['slide right', 'push it right', 'eastward'],
    up: ['up we go', 'lift it', 'higher, nice'],
    down: ['down here', 'drop it lower', 'grounding this'],
  };

  return {
    mood: 'relocating',
    kind: 'drag',
    signature: `drag:${dragging.id}:${bucket}:${getKeywordTag(task?.text) || 'none'}`,
    bubblePool: uniquePool(bucketPhrases[bucket], yeetEgg?.bubblePool, phrasePools.relocating),
    annotationPool: uniquePool(yeetEgg?.annotationPool, notePools.relocating),
    asidePool: uniquePool(yeetEgg?.asidePool, asidePools.relocating),
    eggId: yeetEgg ? 'yeet' : null,
    eyeShift: getRelocationEyeShift(task, dragging),
  };
}

function buildPlayfulScene(cue, tasks) {
  const base = playfulCuePools[cue.type] || playfulCuePools['mascot-pester'];
  const task = cue.taskId ? getTaskById(tasks, cue.taskId) : null;
  const taskTag = getKeywordTag(task?.text);
  const keywordEgg = taskTag ? hoverKeywordEasterEggs[taskTag] : null;

  if (cue.type === 'task-fidget') {
    return {
      mood: 'inspecting',
      kind: 'playful',
      signature: `playful:${cue.type}:${cue.nonce}`,
      bubblePool: uniquePool(
        task?.priority && !task.checked ? ['yes, the urgent one', 'red-flag flirting'] : [],
        task?.checked ? ['already done, champ', 'it is still done'] : [],
        keywordEgg?.bubblePool,
        base.bubblePool,
      ),
      annotationPool: uniquePool(keywordEgg?.annotationPool, base.annotationPool),
      asidePool: uniquePool(keywordEgg?.asidePool, base.asidePool),
      eggId: cue.type,
      eyeShift: 3,
    };
  }

  if (cue.type === 'zoom-in-deep') {
    return {
      mood: 'inspecting',
      kind: 'playful',
      signature: `playful:${cue.type}:${cue.nonce}`,
      bubblePool: uniquePool(
        cue.stage === 'hard' ? ['you are inside the ink now', 'personal space, paper edition', 'okay, microscope champion'] : [],
        base.bubblePool,
      ),
      annotationPool: uniquePool(
        cue.stage === 'hard' ? ['extreme close-up', 'ink molecule watch'] : [],
        base.annotationPool,
      ),
      asidePool: uniquePool(
        cue.stage === 'hard' ? ['the fibers are staring back', 'the pixels have names now'] : [],
        base.asidePool,
      ),
      eggId: cue.type,
      eyeShift: 3,
    };
  }

  if (cue.type === 'zoom-out-deep') {
    return {
      mood: 'curious',
      kind: 'playful',
      signature: `playful:${cue.type}:${cue.nonce}`,
      bubblePool: uniquePool(
        cue.stage === 'hard' ? ['we are in low earth orbit', 'board? what board?', 'this is basically cartography'] : [],
        base.bubblePool,
      ),
      annotationPool: uniquePool(
        cue.stage === 'hard' ? ['orbital pass', 'mapmaker behavior'] : [],
        base.annotationPool,
      ),
      asidePool: uniquePool(
        cue.stage === 'hard' ? ['Houston, we see the whole thing', 'the board became geography'] : [],
        base.asidePool,
      ),
      eggId: cue.type,
      eyeShift: -1,
    };
  }

  return {
    mood: 'curious',
    kind: 'playful',
    signature: `playful:${cue.type}:${cue.nonce}`,
    bubblePool: uniquePool(base.bubblePool),
    annotationPool: uniquePool(base.annotationPool),
    asidePool: uniquePool(base.asidePool),
    eggId: cue.type,
    eyeShift: 1,
  };
}

function buildBoardScene(tasks, lastAction, mood) {
  const boardEgg = getBoardEasterEgg(tasks);
  const total = tasks?.length || 0;
  const done = tasks?.filter(task => task.checked).length || 0;
  const prio = tasks?.filter(task => task.priority && !task.checked).length || 0;

  return {
    mood,
    kind: lastAction ? 'reaction' : 'board',
    signature: lastAction
      ? `action:${lastAction}`
      : `board:${mood}:${total}:${done}:${prio}:${boardEgg?.id || 'none'}`,
    bubblePool: uniquePool(boardEgg?.bubblePool, phrasePools[mood]),
    annotationPool: uniquePool(boardEgg?.annotationPool, notePools[mood]),
    asidePool: uniquePool(boardEgg?.asidePool, asidePools[mood]),
    eggId: boardEgg?.id || null,
    eyeShift: moodConfigs[mood].eyeShift,
  };
}

function getScene(tasks, lastAction, hoveredTaskId, dragging) {
  if (dragging?.type === 'task') {
    return buildDragScene(getTaskById(tasks, dragging.id), dragging);
  }

  const hoveredTask = getTaskById(tasks, hoveredTaskId);
  if (hoveredTask) return buildHoverScene(hoveredTask);

  const mood = getMood(tasks, lastAction);
  return buildBoardScene(tasks, lastAction, mood);
}

function getIdleScene(tasks) {
  const boardEgg = getBoardEasterEgg(tasks);

  return {
    id: `idle:${boardEgg?.id || 'base'}`,
    bubblePool: uniquePool(boardEgg?.bubblePool, phrasePools.idle),
    annotationPool: uniquePool(boardEgg?.annotationPool, notePools.idle),
    asidePool: uniquePool(boardEgg?.asidePool, asidePools.idle),
    eggId: boardEgg?.id || null,
  };
}

export default function Mascot({ tasks, lastAction, hoveredTaskId, dragging, playfulCue }) {
  const containerRef = useRef(null);
  const frameRef = useRef(0);
  const lastInteractionRef = useRef(Date.now());
  const pickSeedRef = useRef(0);
  const previousTextsRef = useRef({ bubble: null, annotation: null, aside: null });
  const idleDismissRef = useRef(null);
  const idleActiveRef = useRef(false);
  const mascotCueTimerRef = useRef(null);
  const mascotHoverTeaseRef = useRef({ count: 0, windowStart: 0 });
  const [lookOffset, setLookOffset] = useState({ x: 0, y: 0 });
  const [idleScene, setIdleScene] = useState(null);
  const [mascotCue, setMascotCue] = useState(null);
  const [displayTexts, setDisplayTexts] = useState({
    bubble: null,
    annotation: 'sharp!',
    aside: 'paper brain',
  });

  const scene = useMemo(
    () => getScene(tasks, lastAction, hoveredTaskId, dragging),
    [tasks, lastAction, hoveredTaskId, dragging],
  );
  const cueScene = useMemo(
    () => (mascotCue || playfulCue ? buildPlayfulScene(mascotCue || playfulCue, tasks) : null),
    [mascotCue, playfulCue, tasks],
  );
  const activeScene = cueScene || idleScene || scene;
  const mood = activeScene.mood || scene.mood;
  const c = useMemo(() => {
    const config = moodConfigs[mood];
    return {
      ...config,
      eyeShift: activeScene.eyeShift ?? scene.eyeShift ?? config.eyeShift,
    };
  }, [activeScene.eyeShift, mood, scene.eyeShift]);
  const mp = mouthPath(c.mouth);
  const np = nosePath();
  const leftBrow = browPath('left', c.browLift);
  const rightBrow = browPath('right', c.browLift);

  const clearIdleScene = useCallback(() => {
    clearTimeout(idleDismissRef.current);
    idleDismissRef.current = null;
    idleActiveRef.current = false;
    setIdleScene(null);
  }, []);

  const clearMascotCue = useCallback(() => {
    clearTimeout(mascotCueTimerRef.current);
    mascotCueTimerRef.current = null;
    setMascotCue(null);
  }, []);

  const triggerMascotCue = useCallback((cue) => {
    clearTimeout(mascotCueTimerRef.current);
    setMascotCue({ ...cue, nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
    mascotCueTimerRef.current = setTimeout(() => {
      setMascotCue(null);
    }, 2600);
  }, []);

  const handleMascotEnter = useCallback(() => {
    lastInteractionRef.current = Date.now();
    if (idleActiveRef.current) clearIdleScene();

    const now = Date.now();
    const current = mascotHoverTeaseRef.current;
    const inSameWindow = now - current.windowStart < 5200;
    const count = inSameWindow ? current.count + 1 : 1;

    mascotHoverTeaseRef.current = {
      count,
      windowStart: inSameWindow ? current.windowStart : now,
    };

    if (count >= 4) {
      triggerMascotCue({ type: 'mascot-pester', count });
      mascotHoverTeaseRef.current = { count: 0, windowStart: 0 };
    }
  }, [clearIdleScene, triggerMascotCue]);

  const queueLookUpdate = useCallback((clientX, clientY) => {
    if (typeof clientX !== 'number' || typeof clientY !== 'number') return;

    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const normalizedX = (clientX - centerX) / Math.max(rect.width * 0.4, 1);
      const normalizedY = (clientY - centerY) / Math.max(rect.height * 0.48, 1);
      const next = {
        x: Math.max(-5.4, Math.min(5.4, normalizedX * 6.2)),
        y: Math.max(-3.6, Math.min(3.6, normalizedY * 4.4)),
      };

      setLookOffset(current => (
        Math.abs(current.x - next.x) < 0.02 && Math.abs(current.y - next.y) < 0.02
          ? current
          : next
      ));
    });
  }, []);

  useEffect(() => {
    const noteActivity = (event) => {
      lastInteractionRef.current = Date.now();
      if (idleActiveRef.current) clearIdleScene();
      if (event?.clientX != null && event?.clientY != null) {
        queueLookUpdate(event.clientX, event.clientY);
      }
    };

    window.addEventListener('pointermove', noteActivity, { passive: true });
    window.addEventListener('pointerdown', noteActivity, { passive: true });
    window.addEventListener('keydown', noteActivity);
    window.addEventListener('wheel', noteActivity, { passive: true });

    return () => {
      window.removeEventListener('pointermove', noteActivity);
      window.removeEventListener('pointerdown', noteActivity);
      window.removeEventListener('keydown', noteActivity);
      window.removeEventListener('wheel', noteActivity);
      clearIdleScene();
      clearMascotCue();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [clearIdleScene, clearMascotCue, queueLookUpdate]);

  useEffect(() => {
    const canIdleChatter = !hoveredTaskId && !dragging?.type && !lastAction;
    if (!canIdleChatter) {
      clearIdleScene();
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (idleActiveRef.current) return;
      if (Date.now() - lastInteractionRef.current < 14000) return;

      idleActiveRef.current = true;
      lastInteractionRef.current = Date.now();
      setIdleScene(getIdleScene(tasks));
      idleDismissRef.current = window.setTimeout(() => {
        idleActiveRef.current = false;
        setIdleScene(null);
      }, 4200);
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [clearIdleScene, dragging?.type, hoveredTaskId, lastAction, tasks]);

  useEffect(() => {
    pickSeedRef.current += 1;
    const seed = pickSeedRef.current;
    const nextTexts = {
      bubble: pickFromPool(activeScene.bubblePool, previousTextsRef.current.bubble, seed),
      annotation: pickFromPool(activeScene.annotationPool, previousTextsRef.current.annotation, seed + 3),
      aside: pickFromPool(activeScene.asidePool, previousTextsRef.current.aside, seed + 7),
    };
    previousTextsRef.current = nextTexts;
    setDisplayTexts(nextTexts);
  }, [activeScene.annotationPool, activeScene.asidePool, activeScene.bubblePool, activeScene.id, activeScene.signature]);

  const liveLook = mood === 'sleeping' ? { x: 0, y: 0 } : lookOffset;
  const eyeTrack = mood === 'sleeping'
    ? { x: 0, y: 0 }
    : { x: liveLook.x * 1.2, y: liveLook.y * 1.08 };
  const noseTrack = mood === 'sleeping'
    ? { x: 0, y: 0 }
    : { x: liveLook.x * 0.38, y: liveLook.y * 0.28 };
  const eggSparkle = activeScene.eggId || scene.eggId;
  const topNoteStyle = {
    fontFamily: "'Caveat', cursive",
    fontSize: 13,
    fill: 'var(--ink-note)',
    stroke: 'var(--bg)',
    strokeWidth: 0.9,
    paintOrder: 'stroke',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  const sideNoteStyle = {
    fontFamily: "'Caveat', cursive",
    fontSize: 10.8,
    fill: 'var(--ink-note)',
    stroke: 'var(--bg)',
    strokeWidth: 0.75,
    paintOrder: 'stroke',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  return (
    <div className="mascot-container" ref={containerRef} onMouseEnter={handleMascotEnter}>
      {displayTexts.bubble && <span className="mascot-bubble">{displayTexts.bubble}</span>}

      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
        <circle cx="50" cy="50" r="45" stroke="var(--guide-line)" strokeWidth="3" fill="none" />
        <line x1="50" y1="0" x2="50" y2="100" stroke="var(--guide-line)" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="var(--guide-line)" strokeWidth="1" strokeDasharray="4 4" />

        <path
          d="M 75 15 L 82 5 L 88 18 L 98 8 L 95 25 L 75 22 Z"
          fill="var(--ink-accent)"
          style={{ transformOrigin: 'center', animation: c.crownAnim }}
        />

        {eggSparkle && (
          <>
            <path d="M 86 28 L 88 23 L 90 28 L 95 30 L 90 32 L 88 37 L 86 32 L 81 30 Z" fill="var(--ink-note)" opacity="0.85" />
            <text x="79" y="20" fontFamily="'Caveat', cursive" fontSize="7" fill="var(--ink-note)">psst</text>
          </>
        )}

        <g
          style={{
            transition: 'transform 0.1s cubic-bezier(0.22, 1, 0.36, 1)',
            transform: `translate(${c.eyeShift + eyeTrack.x}px, ${eyeTrack.y}px)`,
          }}
        >
          {c.eyeR > 0 ? (
            <>
              <circle cx="38" cy={c.eyeY} r={c.eyeR} fill="var(--ink-main)">
                {mood === 'celebrating' && (
                  <animate attributeName="r" values={`${c.eyeR};${c.eyeR + 1};${c.eyeR}`} dur="0.6s" repeatCount="indefinite" />
                )}
              </circle>
              <circle cx="62" cy={c.eyeY} r={c.eyeR} fill="var(--ink-main)">
                {mood === 'celebrating' && (
                  <animate attributeName="r" values={`${c.eyeR};${c.eyeR + 1};${c.eyeR}`} dur="0.6s" repeatCount="indefinite" />
                )}
              </circle>
            </>
          ) : (
            <>
              <path d={`M 33 ${c.eyeY} L 43 ${c.eyeY}`} stroke="var(--ink-main)" strokeWidth="3" strokeLinecap="round" fill="none" />
              <path d={`M 57 ${c.eyeY} L 67 ${c.eyeY}`} stroke="var(--ink-main)" strokeWidth="3" strokeLinecap="round" fill="none" />
            </>
          )}
        </g>

        <path
          d={np}
          stroke="var(--ink-main)"
          strokeWidth="4.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transition: 'transform 0.14s cubic-bezier(0.22, 1, 0.36, 1)',
            transform: `translate(${noseTrack.x}px, ${noseTrack.y}px)`,
          }}
        />

        <path
          d={leftBrow}
          stroke="var(--ink-main)" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'all 0.4s ease' }}
        />
        <path
          d={rightBrow}
          stroke="var(--ink-main)" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: 'all 0.4s ease' }}
        />

        {mp && (
          <path
            d={mp}
            stroke="var(--ink-main)"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            style={{ transition: 'all 0.4s ease' }}
          />
        )}

        <path d="M 9 39 Q 20 14 38 31" fill="none" stroke="var(--ink-note)" strokeWidth="1.15" strokeDasharray="2 2" />
        <text x="-6" y="17" style={topNoteStyle}>{displayTexts.annotation}</text>

        <path d="M 61 79 Q 78 96 101 87" fill="none" stroke="var(--ink-note)" strokeWidth="1.1" strokeDasharray="2 2" opacity="0.9" />
        <text x="67" y="98" style={sideNoteStyle}>{displayTexts.aside}</text>
      </svg>
    </div>
  );
}
