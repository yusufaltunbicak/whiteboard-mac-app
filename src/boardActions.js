const DEFAULT_TASK_WIDTH = 320;
const DEFAULT_TASK_HEIGHT = 180;
const DEFAULT_AREA_COLOR = '#4A90D9';
const DEFAULT_CATEGORY_COLOR = '#4A90D9';
const DEFAULT_LABEL_OPACITY = 1;

function defaultNow() {
  return new Date().toISOString();
}

function defaultId(prefix = '') {
  return `${prefix}${Math.random().toString(36).substring(2, 8)}`;
}

function cloneBoard(board = {}) {
  return {
    ...board,
    tasks: [...(board.tasks || [])],
    labels: [...(board.labels || [])],
    categories: [...(board.categories || [])],
    areas: [...(board.areas || [])],
  };
}

function actionType(action) {
  return String(action?.type || action?.kind || '').trim().replace(/\./g, '_');
}

function arrayFrom(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function idList(action, singularKeys, pluralKeys) {
  for (const key of pluralKeys) {
    const value = arrayFrom(action?.[key]);
    if (value.length) return value;
  }

  for (const key of singularKeys) {
    const value = action?.[key];
    if (value) return [value];
  }

  return [];
}

function pickPatch(source, allowedKeys) {
  const sourcePatch = source?.patch && typeof source.patch === 'object' ? source.patch : source;
  const patch = {};

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(sourcePatch, key)) {
      patch[key] = sourcePatch[key];
    }
  }

  return patch;
}

function taskPatchWithMetadata(task, patch, now) {
  const next = { ...patch };
  if (!Object.prototype.hasOwnProperty.call(next, 'checked')) return next;

  if (next.checked) {
    next.completedAt = next.completedAt || task.completedAt || now();
  } else {
    next.completedAt = null;
  }

  return next;
}

function ensureText(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${fieldName} is required`);
  return text;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function findById(items, id, label) {
  const item = (items || []).find((candidate) => candidate.id === id);
  if (!item) throw new Error(`${label} not found: ${id}`);
  return item;
}

function assertIdsExist(items, ids, label) {
  const existing = new Set((items || []).map((item) => item.id));
  const missing = ids.filter((id) => !existing.has(id));
  if (missing.length) throw new Error(`${label} not found: ${missing.join(', ')}`);
}

function positionForCreate(action, board, index = 0) {
  const position = action?.position && typeof action.position === 'object' ? action.position : {};
  const x = action?.x ?? position.x;
  const y = action?.y ?? position.y;

  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }

  return {
    x: 80 + ((board.tasks || []).length + index) % 4 * 360,
    y: 120 + Math.floor(((board.tasks || []).length + index) / 4) * 220,
  };
}

function normalizeMovePositions(action) {
  if (action?.positions && typeof action.positions === 'object' && !Array.isArray(action.positions)) {
    return action.positions;
  }

  if (Array.isArray(action?.positions)) {
    return Object.fromEntries(action.positions
      .filter(item => item?.id && Number.isFinite(item.x) && Number.isFinite(item.y))
      .map(item => [item.id, { x: item.x, y: item.y }]));
  }

  return null;
}

function applyTaskAction(board, action, context) {
  const type = actionType(action);
  const now = context.now;
  const genId = context.genId;

  if (type === 'create_task' || type === 'task_create') {
    const tasks = Array.isArray(action.tasks) ? action.tasks : [action];
    const nextTasks = tasks.map((taskAction, index) => {
      const position = positionForCreate(taskAction, board, index);
      const checked = Boolean(taskAction.checked);
      return {
        id: taskAction.id || genId('task-'),
        text: ensureText(taskAction.text || taskAction.title || taskAction.name, 'Task text'),
        checked,
        priority: Boolean(taskAction.priority),
        category: taskAction.category ?? taskAction.categoryId ?? null,
        note: taskAction.note || null,
        createdAt: taskAction.createdAt || now(),
        completedAt: checked ? (taskAction.completedAt || now()) : null,
        x: position.x,
        y: position.y,
      };
    });

    return {
      board: { ...board, tasks: [...board.tasks, ...nextTasks] },
      result: { type, ids: nextTasks.map(task => task.id) },
    };
  }

  if (['update_task', 'task_update', 'complete_task', 'set_task_priority', 'set_task_note'].includes(type)) {
    const ids = idList(action, ['id', 'taskId'], ['ids', 'taskIds']);
    if (!ids.length) throw new Error('Task id is required');
    assertIdsExist(board.tasks, ids, 'Task');

    let patch = pickPatch(action, ['text', 'checked', 'priority', 'category', 'categoryId', 'note', 'x', 'y']);
    if (type === 'complete_task') patch.checked = action.checked ?? true;
    if (type === 'set_task_priority') patch.priority = action.priority ?? true;
    if (type === 'set_task_note') patch.note = action.note ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, 'categoryId')) {
      patch.category = patch.categoryId;
      delete patch.categoryId;
    }

    const idSet = new Set(ids);
    return {
      board: {
        ...board,
        tasks: board.tasks.map((task) => {
          if (!idSet.has(task.id)) return task;
          if ((task.external || task.source?.type === 'external') && Object.prototype.hasOwnProperty.call(patch, 'text')) {
            throw new Error(`External task text is read-only in v1: ${task.id}`);
          }
          return { ...task, ...taskPatchWithMetadata(task, patch, now) };
        }),
      },
      result: { type, ids },
    };
  }

  if (['bulk_update_tasks', 'tasks_update'].includes(type)) {
    const ids = idList(action, ['id', 'taskId'], ['ids', 'taskIds']);
    if (!ids.length) throw new Error('Task ids are required');
    assertIdsExist(board.tasks, ids, 'Task');
    const patch = pickPatch(action, ['text', 'checked', 'priority', 'category', 'categoryId', 'note', 'x', 'y']);
    return applyTaskAction(board, { type: 'update_task', ids, patch }, context);
  }

  if (['delete_task', 'delete_tasks', 'task_delete', 'tasks_delete'].includes(type)) {
    const ids = idList(action, ['id', 'taskId'], ['ids', 'taskIds']);
    if (!ids.length) throw new Error('Task ids are required');
    assertIdsExist(board.tasks, ids, 'Task');
    const idSet = new Set(ids);
    return {
      board: { ...board, tasks: board.tasks.filter(task => !idSet.has(task.id)) },
      result: { type, ids },
    };
  }

  if (['move_task', 'move_tasks', 'task_move', 'tasks_move'].includes(type)) {
    const ids = idList(action, ['id', 'taskId'], ['ids', 'taskIds']);
    const positions = normalizeMovePositions(action);
    if (!ids.length && !positions) throw new Error('Task ids or positions are required');
    const targetIds = ids.length ? ids : Object.keys(positions);
    assertIdsExist(board.tasks, targetIds, 'Task');
    const idSet = new Set(targetIds);
    const dx = Number(action.dx ?? action.deltaX ?? 0);
    const dy = Number(action.dy ?? action.deltaY ?? 0);

    return {
      board: {
        ...board,
        tasks: board.tasks.map((task) => {
          if (!idSet.has(task.id)) return task;
          const position = positions?.[task.id];
          if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
            return { ...task, x: position.x, y: position.y };
          }
          return { ...task, x: (task.x || 0) + dx, y: (task.y || 0) + dy };
        }),
      },
      result: { type, ids: targetIds },
    };
  }

  return null;
}

function applyLabelAction(board, action, context) {
  const type = actionType(action);
  const genId = context.genId;

  if (['create_label', 'label_create'].includes(type)) {
    const label = {
      id: action.id || genId('lbl-'),
      text: ensureText(action.text || action.name, 'Label text'),
      x: Number.isFinite(action.x) ? action.x : 120,
      y: Number.isFinite(action.y) ? action.y : 120,
      color: action.color ?? null,
      opacity: typeof action.opacity === 'number' ? action.opacity : DEFAULT_LABEL_OPACITY,
      ...(action.rotate ? { rotate: action.rotate } : {}),
      ...(action.size ? { size: action.size } : {}),
    };
    return {
      board: { ...board, labels: [...board.labels, label] },
      result: { type, ids: [label.id] },
    };
  }

  if (['update_label', 'label_update'].includes(type)) {
    const ids = idList(action, ['id', 'labelId'], ['ids', 'labelIds']);
    if (!ids.length) throw new Error('Label id is required');
    assertIdsExist(board.labels, ids, 'Label');
    const patch = pickPatch(action, ['text', 'x', 'y', 'color', 'opacity', 'rotate', 'size']);
    const idSet = new Set(ids);
    return {
      board: {
        ...board,
        labels: board.labels.map(label => (idSet.has(label.id) ? { ...label, ...patch, editing: false } : label)),
      },
      result: { type, ids },
    };
  }

  if (['delete_label', 'delete_labels', 'label_delete', 'labels_delete'].includes(type)) {
    const ids = idList(action, ['id', 'labelId'], ['ids', 'labelIds']);
    if (!ids.length) throw new Error('Label ids are required');
    assertIdsExist(board.labels, ids, 'Label');
    const idSet = new Set(ids);
    return {
      board: { ...board, labels: board.labels.filter(label => !idSet.has(label.id)) },
      result: { type, ids },
    };
  }

  return null;
}

function applyAreaAction(board, action, context) {
  const type = actionType(action);
  const genId = context.genId;

  if (['create_area', 'area_create'].includes(type)) {
    const area = {
      id: action.id || genId('area-'),
      x: Number.isFinite(action.x) ? action.x : 0,
      y: Number.isFinite(action.y) ? action.y : 0,
      width: Math.max(60, Number.isFinite(action.width) ? action.width : DEFAULT_TASK_WIDTH),
      height: Math.max(60, Number.isFinite(action.height) ? action.height : DEFAULT_TASK_HEIGHT),
      color: action.color || DEFAULT_AREA_COLOR,
      opacity: typeof action.opacity === 'number' ? action.opacity : 0.12,
      locked: Boolean(action.locked),
    };
    return {
      board: { ...board, areas: [...board.areas, area] },
      result: { type, ids: [area.id] },
    };
  }

  if (['update_area', 'area_update'].includes(type)) {
    const ids = idList(action, ['id', 'areaId'], ['ids', 'areaIds']);
    if (!ids.length) throw new Error('Area id is required');
    assertIdsExist(board.areas, ids, 'Area');
    const patch = pickPatch(action, ['x', 'y', 'width', 'height', 'color', 'opacity', 'locked']);
    const idSet = new Set(ids);
    return {
      board: {
        ...board,
        areas: board.areas.map(area => (idSet.has(area.id) ? { ...area, ...patch } : area)),
      },
      result: { type, ids },
    };
  }

  if (['delete_area', 'delete_areas', 'area_delete', 'areas_delete'].includes(type)) {
    const ids = idList(action, ['id', 'areaId'], ['ids', 'areaIds']);
    if (!ids.length) throw new Error('Area ids are required');
    assertIdsExist(board.areas, ids, 'Area');
    const idSet = new Set(ids);
    return {
      board: { ...board, areas: board.areas.filter(area => !idSet.has(area.id)) },
      result: { type, ids },
    };
  }

  return null;
}

function applyCategoryAction(board, action, context) {
  const type = actionType(action);

  if (['create_category', 'category_create'].includes(type)) {
    const name = ensureText(action.name || action.text, 'Category name');
    const id = action.id || slugify(name);
    if (!id) throw new Error('Category id is required');
    if (board.categories.some(category => category.id === id)) {
      throw new Error(`Category already exists: ${id}`);
    }
    const category = {
      id,
      name,
      color: action.color || DEFAULT_CATEGORY_COLOR,
    };
    return {
      board: { ...board, categories: [...board.categories, category] },
      result: { type, ids: [category.id] },
    };
  }

  if (['update_category', 'rename_category', 'category_update', 'category_rename'].includes(type)) {
    const id = action.id || action.categoryId;
    if (!id) throw new Error('Category id is required');
    findById(board.categories, id, 'Category');
    const patch = pickPatch(action, ['name', 'color']);
    if (!Object.keys(patch).length) throw new Error('Category update patch is required');
    return {
      board: {
        ...board,
        categories: board.categories.map(category => (category.id === id ? { ...category, ...patch } : category)),
      },
      result: { type, ids: [id] },
    };
  }

  if (['delete_category', 'category_delete'].includes(type)) {
    const ids = idList(action, ['id', 'categoryId'], ['ids', 'categoryIds']);
    if (!ids.length) throw new Error('Category ids are required');
    assertIdsExist(board.categories, ids, 'Category');
    const idSet = new Set(ids);
    return {
      board: {
        ...board,
        categories: board.categories.filter(category => !idSet.has(category.id)),
        tasks: board.tasks.map(task => (idSet.has(task.category) ? { ...task, category: null } : task)),
      },
      result: { type, ids },
    };
  }

  return null;
}

export function isBoardMutationAction(action) {
  const type = actionType(action);
  return Boolean(type && !['refresh_sync', 'sync_refresh', 'get_board_snapshot'].includes(type));
}

export function applyBoardActions(board, actions, options = {}) {
  if (!Array.isArray(actions)) throw new Error('Actions must be an array');
  const context = {
    now: options.now || defaultNow,
    genId: options.genId || defaultId,
  };
  let next = cloneBoard(board);
  const results = [];

  actions.forEach((action, index) => {
    if (!action || typeof action !== 'object') {
      throw new Error(`Action at index ${index} must be an object`);
    }

    if (!isBoardMutationAction(action)) {
      results.push({ type: actionType(action), skipped: true });
      return;
    }

    const applied = applyTaskAction(next, action, context)
      || applyLabelAction(next, action, context)
      || applyAreaAction(next, action, context)
      || applyCategoryAction(next, action, context);

    if (!applied) {
      throw new Error(`Unsupported board action: ${actionType(action) || '(missing type)'}`);
    }

    next = cloneBoard(applied.board);
    results.push(applied.result);
  });

  return { board: next, results };
}
