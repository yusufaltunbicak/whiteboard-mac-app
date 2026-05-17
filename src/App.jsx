import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import TaskCard from './components/TaskCard';
import TextLabel from './components/TextLabel';
import CanvasArea, { AreaSelectionOverlay } from './components/CanvasArea';
import Mascot from './components/Mascot';
import AddTaskForm from './components/AddTaskForm';
import ContextMenu from './components/ContextMenu';
import {
  chooseSyncFolders,
  getBoard,
  isElectronRuntime,
  onBoardChanged,
  refreshSync,
  saveBoard as persistBoard,
} from './whiteboardApi';

const GRID_SIZE = 30;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const MIN_AREA_SIZE = GRID_SIZE * 2;
const AREA_COLOR_OPTIONS = ['#4A90D9', '#5BAE7C', '#D4A853', '#E87461', '#8575B5', '#E2535B', '#6BB5C9', '#C75D9F'];
const AREA_OPACITY_OPTIONS = [
  { key: 'op-08', value: 0.08, label: '8%' },
  { key: 'op-12', value: 0.12, label: '12%' },
  { key: 'op-16', value: 0.16, label: '16%' },
  { key: 'op-22', value: 0.22, label: '22%' },
  { key: 'op-30', value: 0.3, label: '30%' },
];
const DEFAULT_AREA_OPACITY = AREA_OPACITY_OPTIONS[1].value;
const LABEL_COLOR_OPTIONS = [
  { key: 'label-color-default', value: null, label: 'Default', swatchColor: 'var(--ink-main)' },
  ...AREA_COLOR_OPTIONS.map((color) => ({
    key: `label-color-${color.slice(1).toLowerCase()}`,
    value: color,
    label: color,
    swatchColor: color,
  })),
];
const LABEL_OPACITY_OPTIONS = [
  { key: 'label-op-100', value: 1, label: '100%' },
  { key: 'label-op-72', value: 0.72, label: '72%' },
  { key: 'label-op-45', value: 0.45, label: '45%' },
  { key: 'label-op-28', value: 0.28, label: '28%' },
];
const DEFAULT_LABEL_OPACITY = LABEL_OPACITY_OPTIONS[0].value;
const MIXED_CATEGORY_VALUE = '__mixed__';

function createTaskTimestamp() {
  return new Date().toISOString();
}

function applyTaskPatchWithMetadata(task, patch) {
  if (!patch) return patch;
  if (!Object.prototype.hasOwnProperty.call(patch, 'checked')) return patch;

  if (patch.checked) {
    return {
      ...patch,
      completedAt: patch.completedAt || task.completedAt || createTaskTimestamp(),
    };
  }

  return {
    ...patch,
    completedAt: null,
  };
}

function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function getRectFromPoints(startX, startY, endX, endY) {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  return { x, y, width, height };
}

function hexToRgba(hex, alpha) {
  const normalized = (hex || '').replace('#', '');
  if (normalized.length !== 6) return `rgba(74, 144, 217, ${alpha})`;

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function App() {
  const electronRuntime = isElectronRuntime();
  const [board, setBoard] = useState({ tasks: [], labels: [], categories: [], areas: [] });
  const [dragging, setDragging] = useState(null);
  const [panning, setPanning] = useState(null);
  const [activeTool, setActiveTool] = useState('select');
  const [selectedAreaId, setSelectedAreaId] = useState(null);
  const [draftArea, setDraftArea] = useState(null);
  const [viewOffset, setViewOffset] = useState({ x: 80, y: 30 });
  const [zoom, setZoom] = useState(1);
  const [lastAction, setLastAction] = useState(null);
  const [hoveredTaskId, setHoveredTaskId] = useState(null);
  const [playfulCue, setPlayfulCue] = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [syncInfo, setSyncInfo] = useState(null);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('wb-theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [bulkContextMenu, setBulkContextMenu] = useState(null);
  const [bulkCategoryMenu, setBulkCategoryMenu] = useState(null);

  const viewportRef = useRef(null);
  const boardRef = useRef(board);
  const saveTimer = useRef(null);
  const statusTimer = useRef(null);
  const pendingSave = useRef(null);
  const saveGeneration = useRef(0);
  const lastSavedGeneration = useRef(0);
  const zoomRef = useRef(zoom);
  const offsetRef = useRef(viewOffset);
  const draggingRef = useRef(dragging);
  const panningRef = useRef(panning);
  const draftAreaRef = useRef(draftArea);
  const pointerMoveFrameRef = useRef(null);
  const pendingPointerMoveRef = useRef(null);
  const panLastPointRef = useRef(null);
  const playfulCueTimerRef = useRef(null);
  const taskHoverTeaseRef = useRef({ taskId: null, count: 0, windowStart: 0 });
  const zoomTeaseRef = useRef({ direction: null, triggered: false });

  useEffect(() => { boardRef.current = board; }, [board]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { offsetRef.current = viewOffset; }, [viewOffset]);
  useEffect(() => { draggingRef.current = dragging; }, [dragging]);
  useEffect(() => { panningRef.current = panning; }, [panning]);
  useEffect(() => { draftAreaRef.current = draftArea; }, [draftArea]);

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('wb-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedTaskIds([]);
    setBulkContextMenu(null);
    setBulkCategoryMenu(null);
  }, []);

  const applyDefaults = (data) => {
    const tasks = (data.tasks || []).map((t, i) => ({
      ...t,
      createdAt: t.createdAt ?? null,
      completedAt: t.checked ? (t.completedAt ?? null) : null,
      x: t.x ?? 40 + (i % 3) * 380,
      y: t.y ?? 20 + Math.floor(i / 3) * 240,
    }));
    const labels = (data.labels || []).map((label) => {
      const { faded, ...rest } = label;

      return {
        ...rest,
        opacity: typeof label.opacity === 'number'
          ? label.opacity
          : faded
            ? LABEL_OPACITY_OPTIONS[LABEL_OPACITY_OPTIONS.length - 1].value
            : DEFAULT_LABEL_OPACITY,
      };
    });
    const areas = (data.areas || []).map((area, i) => ({
      ...area,
      x: area.x ?? 0,
      y: area.y ?? 0,
      width: Math.max(MIN_AREA_SIZE, area.width ?? 240),
      height: Math.max(MIN_AREA_SIZE, area.height ?? 180),
      color: area.color || AREA_COLOR_OPTIONS[i % AREA_COLOR_OPTIONS.length],
      opacity: typeof area.opacity === 'number' ? area.opacity : DEFAULT_AREA_OPACITY,
      locked: Boolean(area.locked),
    }));

    return {
      ...data,
      tasks,
      labels,
      areas,
      categories: data.categories || [],
    };
  };

  // Fetch + SSE
  useEffect(() => {
    getBoard()
      .then(d => {
        const next = applyDefaults(d);
        boardRef.current = next;
        setBoard(next);
        setSyncInfo(next.sync || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribe = onBoardChanged((data) => {
      try {
        const next = applyDefaults(data);
        boardRef.current = next;
        setBoard(next);
        setSyncInfo(next.sync || null);
      } catch (_) {}
    });
    return unsubscribe;
  }, []);

  // Save
  const settleSaveStatus = useCallback((status) => {
    clearTimeout(statusTimer.current);
    setSaveStatus(status);

    if (status === 'saved') {
      statusTimer.current = setTimeout(() => {
        setSaveStatus(current => current === 'saved' ? 'idle' : current);
      }, 1800);
    }
  }, []);

  const postBoard = useCallback((data, options = {}) => {
    if (!data) return;

    const { keepalive = false, tryBeacon = false, generation = saveGeneration.current } = options;

    persistBoard(data, { keepalive, tryBeacon })
      .then((result) => {
        if (result?.board) {
          const next = applyDefaults(result.board);
          boardRef.current = next;
          setBoard(next);
          setSyncInfo(next.sync || null);
        } else if (result?.sync) {
          setSyncInfo(result.sync);
        }

        lastSavedGeneration.current = Math.max(lastSavedGeneration.current, generation);

        if (pendingSave.current || generation !== saveGeneration.current) {
          settleSaveStatus('saving');
          return;
        }

        settleSaveStatus('saved');
      })
      .catch(() => {
        if (pendingSave.current || generation !== saveGeneration.current) return;
        settleSaveStatus('error');
      });
  }, [settleSaveStatus]);

  const saveBoard = useCallback((data) => {
    const generation = saveGeneration.current + 1;
    saveGeneration.current = generation;
    pendingSave.current = { data, generation };
    settleSaveStatus('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const latest = pendingSave.current;
      if (!latest) return;
      pendingSave.current = null;
      postBoard(latest.data, { generation: latest.generation });
    }, 400);
  }, [postBoard, settleSaveStatus]);

  const flushBoard = useCallback((tryBeacon = false) => {
    clearTimeout(saveTimer.current);
    const pending = pendingSave.current;
    pendingSave.current = null;

    if (!pending) {
      if (lastSavedGeneration.current === saveGeneration.current) return;
      postBoard(boardRef.current, {
        keepalive: true,
        tryBeacon,
        generation: saveGeneration.current,
      });
      return;
    }

    postBoard(pending.data, {
      keepalive: true,
      tryBeacon,
      generation: pending.generation,
    });
  }, [postBoard]);

  useEffect(() => {
    const handlePageHide = () => flushBoard(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushBoard(true);
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (pointerMoveFrameRef.current != null) {
        window.cancelAnimationFrame(pointerMoveFrameRef.current);
        pointerMoveFrameRef.current = null;
      }
      pendingPointerMoveRef.current = null;
      clearTimeout(statusTimer.current);
      clearTimeout(playfulCueTimerRef.current);
      flushBoard(false);
    };
  }, [flushBoard]);

  const updateBoard = useCallback((updater) => {
    setBoard(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      boardRef.current = next;
      saveBoard(next);
      return next;
    });
  }, [saveBoard]);

  const selectedTaskSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const selectedTasks = useMemo(
    () => board.tasks.filter((task) => selectedTaskSet.has(task.id)),
    [board.tasks, selectedTaskSet],
  );
  const selectedTaskCount = selectedTasks.length;
  const allSelectedPriority = selectedTaskCount > 0 && selectedTasks.every((task) => task.priority);
  const allSelectedChecked = selectedTaskCount > 0 && selectedTasks.every((task) => task.checked);
  const hasSelectedCategory = selectedTasks.some((task) => task.category != null);
  const sharedCategoryId = useMemo(() => {
    if (!selectedTasks.length) return null;
    const firstCategory = selectedTasks[0].category ?? null;
    const isMixed = selectedTasks.some((task) => (task.category ?? null) !== firstCategory);
    return isMixed ? MIXED_CATEGORY_VALUE : firstCategory;
  }, [selectedTasks]);
  const sharedCategory = useMemo(() => {
    if (sharedCategoryId == null || sharedCategoryId === MIXED_CATEGORY_VALUE) return null;
    return board.categories.find((category) => category.id === sharedCategoryId) || null;
  }, [board.categories, sharedCategoryId]);

  useEffect(() => {
    if (selectedAreaId && !(board.areas || []).some(area => area.id === selectedAreaId)) {
      setSelectedAreaId(null);
    }
  }, [board.areas, selectedAreaId]);

  useEffect(() => {
    const liveTaskIds = new Set((board.tasks || []).map((task) => task.id));
    setSelectedTaskIds((current) => {
      const next = current.filter((id) => liveTaskIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [board.tasks]);

  useEffect(() => {
    if (selectedTaskCount === 0) {
      setBulkContextMenu(null);
      setBulkCategoryMenu(null);
      return;
    }

    if (selectedTaskCount < 2) {
      setBulkContextMenu(null);
      setBulkCategoryMenu(null);
    }
  }, [selectedTaskCount]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return;

      const target = e.target;
      if (target instanceof HTMLElement && (
        target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.isContentEditable
      )) {
        return;
      }

      draftAreaRef.current = null;
      setDraftArea(null);
      setActiveTool(current => current === 'area' ? 'select' : current);
      clearSelection();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection]);

  const flash = useCallback((action) => {
    setLastAction(action);
    setTimeout(() => setLastAction(null), 3000);
  }, []);

  const triggerPlayfulCue = useCallback((cue) => {
    clearTimeout(playfulCueTimerRef.current);
    setPlayfulCue({ ...cue, nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
    playfulCueTimerRef.current = setTimeout(() => {
      setPlayfulCue(null);
    }, 2800);
  }, []);

  const resetZoomTease = useCallback(() => {
    zoomTeaseRef.current = { direction: null, triggered: false };
  }, []);

  const maybeTriggerZoomCue = useCallback((direction, prevZoom, nextZoom) => {
    if (!['in', 'out'].includes(direction)) return;

    const isZoomIn = direction === 'in';
    const softThreshold = isZoomIn ? 2.45 : 0.22;
    const hardThreshold = isZoomIn ? 2.85 : 0.17;
    const prevZone = isZoomIn
      ? (prevZoom >= hardThreshold ? 'hard' : prevZoom >= softThreshold ? 'soft' : 'none')
      : (prevZoom <= hardThreshold ? 'hard' : prevZoom <= softThreshold ? 'soft' : 'none');
    const nextZone = isZoomIn
      ? (nextZoom >= hardThreshold ? 'hard' : nextZoom >= softThreshold ? 'soft' : 'none')
      : (nextZoom <= hardThreshold ? 'hard' : nextZoom <= softThreshold ? 'soft' : 'none');
    const current = zoomTeaseRef.current;

    if (nextZone === 'none') {
      if (current.direction === direction) resetZoomTease();
      return;
    }

    if (current.direction !== direction) {
      zoomTeaseRef.current = { direction, triggered: false };
    }

    if (zoomTeaseRef.current.triggered || prevZone !== 'none') return;

    zoomTeaseRef.current = { direction, triggered: true };
    triggerPlayfulCue({
      type: isZoomIn ? 'zoom-in-deep' : 'zoom-out-deep',
      stage: nextZone === 'hard' ? 'hard' : 'base',
      zoom: nextZoom,
    });
  }, [resetZoomTease, triggerPlayfulCue]);

  const applyZoom = useCallback((nextZoom, anchorX, anchorY, direction) => {
    const prevZoom = zoomRef.current;
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));

    setViewOffset(prev => ({
      x: anchorX - (anchorX - prev.x) * (clampedZoom / prevZoom),
      y: anchorY - (anchorY - prev.y) * (clampedZoom / prevZoom),
    }));
    setZoom(clampedZoom);
    maybeTriggerZoomCue(direction, prevZoom, clampedZoom);
  }, [maybeTriggerZoomCue]);

  const handleTaskHoverStart = useCallback((id) => {
    setHoveredTaskId(id);
    const now = Date.now();
    const current = taskHoverTeaseRef.current;
    const inSameWindow = current.taskId === id && now - current.windowStart < 3200;
    const count = inSameWindow ? current.count + 1 : 1;

    taskHoverTeaseRef.current = {
      taskId: id,
      count,
      windowStart: inSameWindow ? current.windowStart : now,
    };

    if (count >= 3) {
      triggerPlayfulCue({ type: 'task-fidget', taskId: id, count });
      taskHoverTeaseRef.current = { taskId: id, count: 0, windowStart: 0 };
    }
  }, [triggerPlayfulCue]);

  const handleTaskHoverEnd = useCallback((id) => {
    setHoveredTaskId(current => current === id ? null : current);
  }, []);

  // ---- Coordinate conversion ----
  const screenToWorld = useCallback((sx, sy) => ({
    x: (sx - offsetRef.current.x) / zoomRef.current,
    y: (sy - offsetRef.current.y) / zoomRef.current,
  }), []);

  const screenToSnappedWorld = useCallback((sx, sy) => {
    const point = screenToWorld(sx, sy);
    return {
      x: snapToGrid(point.x),
      y: snapToGrid(point.y),
    };
  }, [screenToWorld]);

  const finalizeDraftArea = useCallback((draft) => {
    if (!draft) return false;

    const rect = getRectFromPoints(draft.startX, draft.startY, draft.currentX, draft.currentY);
    if (rect.width < MIN_AREA_SIZE || rect.height < MIN_AREA_SIZE) return false;

    const id = `area-${Math.random().toString(36).substring(2, 8)}`;
    updateBoard(prev => ({
      ...prev,
      areas: [...(prev.areas || []), {
        id,
        ...rect,
        color: AREA_COLOR_OPTIONS[prev.areas.length % AREA_COLOR_OPTIONS.length],
        opacity: DEFAULT_AREA_OPACITY,
        locked: false,
      }],
    }));
    setSelectedAreaId(id);
    setActiveTool('select');
    return true;
  }, [updateBoard]);

  // ---- Task Handlers ----
  const addTask = useCallback((text, categoryId, priority) => {
    const vp = viewportRef.current;
    const center = screenToWorld(vp.clientWidth / 2, vp.clientHeight / 2);
    updateBoard(prev => ({
      ...prev,
      tasks: [...prev.tasks, {
        id: Math.random().toString(36).substring(2, 8),
        text, checked: false, priority,
        category: categoryId, note: null,
        createdAt: createTaskTimestamp(),
        completedAt: null,
        x: center.x - 150 + (Math.random() * 100 - 50),
        y: center.y - 50 + (Math.random() * 80 - 40),
      }],
    }));
    flash('add');
  }, [updateBoard, flash, screenToWorld]);

  const toggleTask = useCallback((id) => {
    updateBoard(prev => ({
      ...prev,
      tasks: prev.tasks.map((task) => {
        if (task.id !== id) return task;
        const checked = !task.checked;
        return {
          ...task,
          checked,
          completedAt: checked ? (task.completedAt || createTaskTimestamp()) : null,
        };
      }),
    }));
    flash('complete');
  }, [updateBoard, flash]);

  const deleteTask = useCallback((id) => {
    updateBoard(prev => ({ ...prev, tasks: prev.tasks.filter(t => t.id !== id) }));
    setHoveredTaskId(current => current === id ? null : current);
    setSelectedTaskIds(current => current.filter(taskId => taskId !== id));
    setBulkContextMenu(null);
    setBulkCategoryMenu(null);
    flash('delete');
  }, [updateBoard, flash]);

  const updateNote = useCallback((id, note) => {
    updateBoard(prev => ({
      ...prev,
      tasks: prev.tasks.map(t => t.id === id ? { ...t, note: note || null } : t),
    }));
  }, [updateBoard]);

  const patchTask = useCallback((id, patch) => {
    updateBoard(prev => ({
      ...prev,
      tasks: prev.tasks.map((task) => {
        if (task.id !== id) return task;
        return { ...task, ...applyTaskPatchWithMetadata(task, patch) };
      }),
    }));
  }, [updateBoard]);

  const patchTasks = useCallback((ids, patch) => {
    if (!ids.length) return;

    const idSet = new Set(ids);
    updateBoard(prev => ({
      ...prev,
      tasks: prev.tasks.map((task) => {
        if (!idSet.has(task.id)) return task;
        const nextPatch = typeof patch === 'function' ? patch(task) : patch;
        return { ...task, ...applyTaskPatchWithMetadata(task, nextPatch) };
      }),
    }));
  }, [updateBoard]);

  const addCategory = useCallback((name, color) => {
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    updateBoard(prev => ({
      ...prev,
      categories: [...prev.categories, { id, name, color }],
    }));
  }, [updateBoard]);

  const deleteCategory = useCallback((catId) => {
    updateBoard(prev => ({
      ...prev,
      categories: prev.categories.filter(c => c.id !== catId),
      tasks: prev.tasks.map(t => t.category === catId ? { ...t, category: null } : t),
    }));
  }, [updateBoard]);

  const renameCategory = useCallback((catId, newName, newColor) => {
    updateBoard(prev => ({
      ...prev,
      categories: prev.categories.map(c =>
        c.id === catId ? { ...c, name: newName, ...(newColor ? { color: newColor } : {}) } : c
      ),
    }));
  }, [updateBoard]);

  const handleBulkCategoryAssign = useCallback((categoryId) => {
    if (!selectedTaskIds.length) return;
    patchTasks(selectedTaskIds, { category: categoryId });
    setBulkCategoryMenu(null);
    setBulkContextMenu(null);
  }, [patchTasks, selectedTaskIds]);

  const handleBulkPriorityToggle = useCallback(() => {
    if (!selectedTaskIds.length) return;
    patchTasks(selectedTaskIds, { priority: !allSelectedPriority });
    setBulkContextMenu(null);
  }, [allSelectedPriority, patchTasks, selectedTaskIds]);

  const handleBulkCheckedToggle = useCallback(() => {
    if (!selectedTaskIds.length) return;
    patchTasks(selectedTaskIds, { checked: !allSelectedChecked });
    setBulkContextMenu(null);
    flash('complete');
  }, [allSelectedChecked, patchTasks, selectedTaskIds, flash]);

  const handleBulkDelete = useCallback(() => {
    if (!selectedTaskIds.length) return;

    if (selectedTaskIds.length > 1) {
      const confirmed = window.confirm(`Delete ${selectedTaskIds.length} tasks?`);
      if (!confirmed) return;
    }

    updateBoard(prev => ({
      ...prev,
      tasks: prev.tasks.filter((task) => !selectedTaskSet.has(task.id)),
    }));
    setHoveredTaskId((current) => (current && selectedTaskSet.has(current) ? null : current));
    clearSelection();
    flash('delete');
  }, [clearSelection, flash, selectedTaskIds, selectedTaskSet, updateBoard]);

  // ---- Zoom (wheel) ----
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const z = zoomRef.current;
      const vo = offsetRef.current;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      const mx = e.clientX;
      const my = e.clientY;
      applyZoom(nz, mx, my, factor > 1 ? 'in' : 'out');
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [applyZoom]);

  // ---- Pan ----
  const handleViewportPointerDown = useCallback((e) => {
    if (e.target.closest('.task-card, .text-label, .canvas-area, .area-overlay-handle, .toolbar, .zoom-controls, .bulk-action-bar, .ctx-menu, .prompt-overlay, .prompt-box')) return;
    if (e.button !== 0) return;

    if (activeTool === 'area') {
      const point = screenToSnappedWorld(e.clientX, e.clientY);
      const nextDraftArea = {
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
      };
      draftAreaRef.current = nextDraftArea;
      setDraftArea(nextDraftArea);
      setSelectedAreaId(null);
      e.preventDefault();
      return;
    }

    setSelectedAreaId(null);
    clearSelection();
    const nextPanning = { active: true };
    panningRef.current = nextPanning;
    panLastPointRef.current = { clientX: e.clientX, clientY: e.clientY };
    setPanning(nextPanning);
    e.preventDefault();
  }, [activeTool, clearSelection, screenToSnappedWorld]);

  // ---- Item drag ----
  const handleDragStart = useCallback((e, id, type, dragIds = [id]) => {
    if (e.button !== 0) return;
    const items = type === 'task'
      ? boardRef.current.tasks
      : type === 'label'
        ? boardRef.current.labels
        : boardRef.current.areas;
    const dragIdSet = new Set(dragIds);
    const draggedItems = items.filter((item) => dragIdSet.has(item.id));
    const item = draggedItems.find(i => i.id === id);
    if (!item || draggedItems.length === 0) return;
    if (type === 'area' && item.locked) {
      setSelectedAreaId(id);
      return;
    }
    const wp = screenToWorld(e.clientX, e.clientY);
    const nextDragging = {
      id,
      ids: draggedItems.map((draggedItem) => draggedItem.id),
      type,
      startPointer: wp,
      startPositions: Object.fromEntries(
        draggedItems.map((draggedItem) => [
          draggedItem.id,
          { x: draggedItem.x || 0, y: draggedItem.y || 0 },
        ]),
      ),
    };
    draggingRef.current = nextDragging;
    setDragging(nextDragging);
    if (type === 'area') setSelectedAreaId(id);
    e.preventDefault();
  }, [screenToWorld]);

  const handleAreaResizeStart = useCallback((e, id, handle) => {
    if (e.button !== 0) return;

    const area = (boardRef.current.areas || []).find((item) => item.id === id);
    if (!area || area.locked) return;

    e.preventDefault();
    e.stopPropagation();

    setSelectedAreaId(id);
    const nextDragging = {
      id,
      type: 'area-resize',
      handle,
      startPointer: screenToSnappedWorld(e.clientX, e.clientY),
      startArea: { ...area },
    };
    draggingRef.current = nextDragging;
    setDragging(nextDragging);
  }, [screenToSnappedWorld]);

  const handleTaskPointerDown = useCallback((e, task) => {
    if (e.button !== 0) return;

    setSelectedAreaId(null);
    setBulkContextMenu(null);
    setBulkCategoryMenu(null);

    if (e.pointerType === 'touch') {
      handleDragStart(e, task.id, 'task', [task.id]);
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setSelectedTaskIds((current) => (
        current.includes(task.id)
          ? current.filter((id) => id !== task.id)
          : [...current, task.id]
      ));
      return;
    }

    const dragIds = selectedTaskSet.has(task.id) ? selectedTaskIds : [task.id];
    setSelectedTaskIds((current) => {
      const sameSelection = current.length === dragIds.length && dragIds.every((id) => current.includes(id));
      return sameSelection ? current : dragIds;
    });
    handleDragStart(e, task.id, 'task', dragIds);
  }, [handleDragStart, selectedTaskIds, selectedTaskSet]);

  const handleTaskContextMenu = useCallback((e, task) => {
    setSelectedAreaId(null);
    setBulkCategoryMenu(null);

    if (selectedTaskSet.has(task.id) && selectedTaskIds.length > 1) {
      e.preventDefault();
      e.stopPropagation();
      setBulkContextMenu({ x: e.clientX, y: e.clientY });
      return true;
    }

    setBulkContextMenu(null);
    setSelectedTaskIds((current) => (
      current.length === 1 && current[0] === task.id ? current : [task.id]
    ));
    return false;
  }, [selectedTaskIds.length, selectedTaskSet]);

  // ---- Move ----
  const processPointerMove = useCallback((clientX, clientY) => {
    const currentPanning = panningRef.current;
    const currentDraftArea = draftAreaRef.current;
    const currentDragging = draggingRef.current;

    if (currentPanning) {
      const lastPoint = panLastPointRef.current;
      if (!lastPoint) {
        panLastPointRef.current = { clientX, clientY };
        return;
      }

      const deltaX = clientX - lastPoint.clientX;
      const deltaY = clientY - lastPoint.clientY;
      panLastPointRef.current = { clientX, clientY };

      if (deltaX || deltaY) {
        setViewOffset(prev => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY,
        }));
      }
      return;
    }

    if (currentDraftArea) {
      const point = screenToSnappedWorld(clientX, clientY);
      const nextDraftArea = {
        ...currentDraftArea,
        currentX: point.x,
        currentY: point.y,
      };
      draftAreaRef.current = nextDraftArea;
      setDraftArea(nextDraftArea);
      return;
    }

    if (currentDragging?.type === 'area-resize') {
      const point = screenToSnappedWorld(clientX, clientY);
      setBoard(prev => {
        const next = {
          ...prev,
          areas: prev.areas.map((area) => {
            if (area.id !== currentDragging.id) return area;

            const left = currentDragging.startArea.x;
            const top = currentDragging.startArea.y;
            const right = currentDragging.startArea.x + currentDragging.startArea.width;
            const bottom = currentDragging.startArea.y + currentDragging.startArea.height;

            let nextLeft = left;
            let nextTop = top;
            let nextRight = right;
            let nextBottom = bottom;

            if (currentDragging.handle.includes('n')) {
              nextTop = Math.min(point.y, bottom - MIN_AREA_SIZE);
            }
            if (currentDragging.handle.includes('s')) {
              nextBottom = Math.max(point.y, top + MIN_AREA_SIZE);
            }
            if (currentDragging.handle.includes('w')) {
              nextLeft = Math.min(point.x, right - MIN_AREA_SIZE);
            }
            if (currentDragging.handle.includes('e')) {
              nextRight = Math.max(point.x, left + MIN_AREA_SIZE);
            }

            return {
              ...area,
              x: nextLeft,
              y: nextTop,
              width: nextRight - nextLeft,
              height: nextBottom - nextTop,
            };
          }),
        };
        boardRef.current = next;
        return next;
      });
      return;
    }

    if (currentDragging) {
      const wp = screenToWorld(clientX, clientY);
      const key = currentDragging.type === 'task'
        ? 'tasks'
        : currentDragging.type === 'label'
          ? 'labels'
          : 'areas';
      const deltaX = wp.x - currentDragging.startPointer.x;
      const deltaY = wp.y - currentDragging.startPointer.y;
      setBoard(prev => {
        const next = {
          ...prev,
          [key]: prev[key].map(item =>
            currentDragging.startPositions[item.id]
              ? {
                ...item,
                x: currentDragging.type === 'area'
                  ? snapToGrid(currentDragging.startPositions[item.id].x + deltaX)
                  : currentDragging.startPositions[item.id].x + deltaX,
                y: currentDragging.type === 'area'
                  ? snapToGrid(currentDragging.startPositions[item.id].y + deltaY)
                  : currentDragging.startPositions[item.id].y + deltaY,
              }
              : item
          ),
        };
        boardRef.current = next;
        return next;
      });
    }
  }, [screenToSnappedWorld, screenToWorld]);

  const flushPendingPointerMove = useCallback(() => {
    if (pointerMoveFrameRef.current != null) {
      window.cancelAnimationFrame(pointerMoveFrameRef.current);
      pointerMoveFrameRef.current = null;
    }

    const pendingMove = pendingPointerMoveRef.current;
    pendingPointerMoveRef.current = null;

    if (pendingMove) {
      processPointerMove(pendingMove.clientX, pendingMove.clientY);
    }
  }, [processPointerMove]);

  const handlePointerMove = useCallback((e) => {
    pendingPointerMoveRef.current = { clientX: e.clientX, clientY: e.clientY };

    if (pointerMoveFrameRef.current != null) return;

    pointerMoveFrameRef.current = window.requestAnimationFrame(() => {
      pointerMoveFrameRef.current = null;
      const pendingMove = pendingPointerMoveRef.current;
      pendingPointerMoveRef.current = null;
      if (!pendingMove) return;
      processPointerMove(pendingMove.clientX, pendingMove.clientY);
    });
  }, [processPointerMove]);

  const handlePointerUp = useCallback(() => {
    flushPendingPointerMove();

    const currentDraftArea = draftAreaRef.current;
    const currentDragging = draggingRef.current;
    const currentPanning = panningRef.current;

    if (currentDraftArea) {
      finalizeDraftArea(currentDraftArea);
      draftAreaRef.current = null;
      setDraftArea(null);
    }
    if (currentDragging) {
      draggingRef.current = null;
      setDragging(null);
      setTimeout(() => saveBoard(boardRef.current), 10);
    }
    if (currentPanning) {
      panningRef.current = null;
      panLastPointRef.current = null;
      setPanning(null);
    }
  }, [finalizeDraftArea, flushPendingPointerMove, saveBoard]);

  // ---- Double-click for labels ----
  const handleDoubleClick = useCallback((e) => {
    if (activeTool === 'area') return;
    if (e.target.closest('.task-card, .text-label, .canvas-area, .area-overlay-handle, .toolbar, .zoom-controls, .ctx-menu, .prompt-overlay, .prompt-box')) return;
    const wp = screenToWorld(e.clientX, e.clientY);
    setBoard(prev => {
      const next = {
        ...prev,
        labels: [...(prev.labels || []), {
        id: `lbl-${Math.random().toString(36).substring(2, 8)}`,
        text: '',
        x: wp.x,
        y: wp.y,
        editing: true,
        color: null,
        opacity: DEFAULT_LABEL_OPACITY,
      }],
      };
      boardRef.current = next;
      return next;
    });
  }, [activeTool, screenToWorld]);

  const updateLabel = useCallback((id, text) => {
    if (!text.trim()) {
      updateBoard(prev => ({ ...prev, labels: prev.labels.filter(l => l.id !== id) }));
    } else {
      updateBoard(prev => ({
        ...prev,
        labels: prev.labels.map(l => l.id === id ? { ...l, text, editing: false } : l),
      }));
    }
  }, [updateBoard]);

  const patchLabel = useCallback((id, patch) => {
    updateBoard(prev => ({
      ...prev,
      labels: prev.labels.map(l => l.id === id ? { ...l, ...patch } : l),
    }));
  }, [updateBoard]);

  const deleteLabel = useCallback((id) => {
    updateBoard(prev => ({ ...prev, labels: prev.labels.filter(l => l.id !== id) }));
  }, [updateBoard]);

  const patchArea = useCallback((id, patch) => {
    updateBoard(prev => ({
      ...prev,
      areas: prev.areas.map(area => area.id === id ? { ...area, ...patch } : area),
    }));
  }, [updateBoard]);

  const deleteArea = useCallback((id) => {
    setSelectedAreaId(current => current === id ? null : current);
    updateBoard(prev => ({
      ...prev,
      areas: prev.areas.filter(area => area.id !== id),
    }));
  }, [updateBoard]);

  // ---- Zoom controls ----
  const zoomTo = useCallback((factor) => {
    const vp = viewportRef.current;
    const cx = vp.clientWidth / 2;
    const cy = vp.clientHeight / 2;
    const z = zoomRef.current;
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
    applyZoom(nz, cx, cy, factor > 1 ? 'in' : 'out');
  }, [applyZoom]);

  const fitAll = useCallback(() => {
    const bounds = [
      ...board.tasks.map(task => ({
        minX: task.x || 0,
        minY: task.y || 0,
        maxX: (task.x || 0) + 320,
        maxY: (task.y || 0) + 180,
      })),
      ...(board.labels || []).map(label => ({
        minX: label.x || 0,
        minY: label.y || 0,
        maxX: (label.x || 0) + 240,
        maxY: (label.y || 0) + 90,
      })),
      ...(board.areas || []).map(area => ({
        minX: area.x || 0,
        minY: area.y || 0,
        maxX: (area.x || 0) + (area.width || 0),
        maxY: (area.y || 0) + (area.height || 0),
      })),
    ];

    if (bounds.length === 0) {
      resetZoomTease();
      setViewOffset({ x: 80, y: 30 });
      setZoom(1);
      return;
    }
    const vp = viewportRef.current;
    const pad = 80;
    const tbH = 130;
    const minX = Math.min(...bounds.map(item => item.minX));
    const minY = Math.min(...bounds.map(item => item.minY));
    const maxX = Math.max(...bounds.map(item => item.maxX));
    const maxY = Math.max(...bounds.map(item => item.maxY));
    const cW = maxX - minX + pad * 2;
    const cH = maxY - minY + pad * 2;
    const vW = vp.clientWidth;
    const vH = vp.clientHeight - tbH;
    const nz = Math.min(1.5, Math.max(0.2, Math.min(vW / cW, vH / cH)));
    resetZoomTease();
    setZoom(nz);
    setViewOffset({
      x: (vW - cW * nz) / 2 - minX * nz + pad * nz,
      y: tbH + (vH - cH * nz) / 2 - minY * nz + pad * nz,
    });
  }, [board.tasks, board.labels, board.areas, resetZoomTease]);

  const cursorStyle = draftArea
    ? 'crosshair'
    : panning
      ? 'grabbing'
      : dragging
        ? 'grabbing'
        : activeTool === 'area'
          ? 'crosshair'
          : 'crosshair';
  const selectedArea = useMemo(
    () => (board.areas || []).find((area) => area.id === selectedAreaId) || null,
    [board.areas, selectedAreaId],
  );
  const nextAreaColor = AREA_COLOR_OPTIONS[(board.areas || []).length % AREA_COLOR_OPTIONS.length];
  const draftPreview = useMemo(() => {
    if (!draftArea) return null;

    const rect = getRectFromPoints(draftArea.startX, draftArea.startY, draftArea.currentX, draftArea.currentY);
    return rect.width > 0 && rect.height > 0
      ? { ...rect, id: 'draft-area', color: nextAreaColor, opacity: DEFAULT_AREA_OPACITY, locked: false }
      : null;
  }, [draftArea, nextAreaColor]);
  const saveStatusMeta = useMemo(() => ({
    idle: { label: 'Ready', className: 'is-idle' },
    saving: { label: 'Saving...', className: 'is-saving' },
    saved: { label: 'Saved', className: 'is-saved' },
    error: { label: 'Save failed', className: 'is-error' },
  }[saveStatus]), [saveStatus]);
  const bulkCategoryItems = useMemo(() => ([
    {
      icon: '∅',
      label: 'Uncategorized',
      selected: sharedCategoryId === null,
      action: () => handleBulkCategoryAssign(null),
    },
    ...board.categories.map((category) => ({
      swatchColor: category.color,
      label: category.name,
      selected: sharedCategoryId === category.id,
      action: () => handleBulkCategoryAssign(category.id),
    })),
  ]), [board.categories, handleBulkCategoryAssign, sharedCategoryId]);
  const bulkMenuItems = useMemo(() => ([
    {
      icon: '#',
      label: sharedCategoryId === MIXED_CATEGORY_VALUE
        ? 'Category'
        : sharedCategory
          ? `Category: ${sharedCategory.name}`
          : 'Category',
      children: bulkCategoryItems,
    },
    {
      icon: allSelectedPriority ? '\u2606' : '\u2605',
      label: allSelectedPriority ? 'Clear priority' : 'Set priority',
      action: handleBulkPriorityToggle,
    },
    {
      icon: allSelectedChecked ? '\u25CB' : '\u2713',
      label: allSelectedChecked ? 'Mark incomplete' : 'Mark complete',
      action: handleBulkCheckedToggle,
    },
    { divider: true },
    {
      icon: 'x',
      label: 'Delete',
      danger: true,
      action: handleBulkDelete,
    },
    {
      icon: 'esc',
      label: 'Clear selection',
      action: clearSelection,
    },
  ]), [
    allSelectedChecked,
    allSelectedPriority,
    bulkCategoryItems,
    clearSelection,
    handleBulkCheckedToggle,
    handleBulkDelete,
    handleBulkPriorityToggle,
    sharedCategory,
    sharedCategoryId,
  ]);

  const handleSyncClick = useCallback(async () => {
    if (!isElectronRuntime()) return;

    try {
      const result = syncInfo?.enabled && syncInfo?.folders?.length
        ? await refreshSync()
        : await chooseSyncFolders();
      if (!result) return;
      const next = applyDefaults(result);
      boardRef.current = next;
      setBoard(next);
      setSyncInfo(next.sync || null);
    } catch (_) {
      settleSaveStatus('error');
    }
  }, [settleSaveStatus, syncInfo]);

  return (
    <div className={`app-shell ${electronRuntime ? 'electron-runtime' : ''}`}>
      {/* Paper texture */}
      <svg className="paper-texture">
        <filter id="noiseFilter">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="matrix" values="1 0 0 0 0, 0 1 0 0 0, 0 0 1 0 0, 0 0 0 0.1 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noiseFilter)" />
      </svg>

      {/* Fixed toolbar */}
      <div className={`toolbar ${toolbarHidden ? 'toolbar-hidden' : ''}`}>
        <div className="toolbar-inner">
          <div className="toolbar-brand">
            <span className="anno-tag">#MASTER_LIST</span>
            <h1>
              To-Do Sketch
              <span className="title-underline" />
            </h1>
          </div>
          <div className="toolbar-form">
            <AddTaskForm
              categories={board.categories}
              onAdd={addTask}
              onAddCategory={addCategory}
              onDeleteCategory={deleteCategory}
              onRenameCategory={renameCategory}
            />
          </div>
          <div className="toolbar-mascot">
            <Mascot
              tasks={board.tasks}
              lastAction={lastAction}
              hoveredTaskId={hoveredTaskId}
              dragging={dragging}
              playfulCue={playfulCue}
            />
          </div>
        </div>
      </div>

      {/* Infinite canvas */}
      <div
        className="canvas-viewport"
        ref={viewportRef}
        style={{
          cursor: cursorStyle,
          '--dot-size': `${30 * zoom}px`,
          '--dot-x': `${viewOffset.x % (30 * zoom)}px`,
          '--dot-y': `${viewOffset.y % (30 * zoom)}px`,
        }}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className="canvas-world"
          style={{
            transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {(board.areas || []).map((area) => (
            <CanvasArea
              key={area.id}
              area={area}
              isSelected={selectedAreaId === area.id}
              onSelect={setSelectedAreaId}
              onPatch={patchArea}
              onDelete={deleteArea}
              onDragStart={handleDragStart}
              colorOptions={AREA_COLOR_OPTIONS}
              opacityOptions={AREA_OPACITY_OPTIONS}
            />
          ))}
          {draftPreview && (
            <div
              className="canvas-area canvas-area-draft"
              style={{
                left: draftPreview.x,
                top: draftPreview.y,
                width: draftPreview.width,
                height: draftPreview.height,
                background: `linear-gradient(180deg, ${hexToRgba(draftPreview.color, Math.min(draftPreview.opacity + 0.04, 0.28))} 0%, ${hexToRgba(draftPreview.color, draftPreview.opacity)} 100%)`,
                borderColor: hexToRgba(draftPreview.color, Math.min(draftPreview.opacity + 0.18, 0.42)),
              }}
            />
          )}
          {board.tasks.map((task, i) => (
            <TaskCard
              key={task.id}
              task={task}
              index={i}
              category={board.categories.find(c => c.id === task.category)}
              categories={board.categories}
              selected={selectedTaskSet.has(task.id)}
              onToggle={toggleTask}
              onDelete={deleteTask}
              onUpdateNote={updateNote}
              onPatch={patchTask}
              onDragStart={handleDragStart}
              onTaskPointerDown={handleTaskPointerDown}
              onTaskContextMenu={handleTaskContextMenu}
              isDragging={dragging?.type === 'task' && dragging.ids?.includes(task.id)}
              onHoverStart={handleTaskHoverStart}
              onHoverEnd={handleTaskHoverEnd}
              isExternal={Boolean(task.external)}
            />
          ))}
          {(board.labels || []).map(label => (
            <TextLabel
              key={label.id}
              label={label}
              onUpdate={updateLabel}
              onPatch={patchLabel}
              onDelete={deleteLabel}
              onDragStart={handleDragStart}
              isDragging={dragging?.type === 'label' && dragging.id === label.id}
              colorOptions={LABEL_COLOR_OPTIONS}
              opacityOptions={LABEL_OPACITY_OPTIONS}
            />
          ))}
          {selectedArea && (
            <AreaSelectionOverlay
              area={selectedArea}
              onResizeStart={handleAreaResizeStart}
            />
          )}
          {draftPreview && (
            <AreaSelectionOverlay
              area={draftPreview}
              onResizeStart={() => {}}
              isDraft
            />
          )}
        </div>
      </div>

      {selectedTaskCount > 1 && (
        <div className="bulk-action-bar" role="toolbar" aria-label="Selected task actions">
          <span className="bulk-count">{selectedTaskCount} selected</span>
          <button
            type="button"
            className="bulk-action-btn"
            onClick={(e) => {
              setBulkContextMenu(null);
              const rect = e.currentTarget.getBoundingClientRect();
              setBulkCategoryMenu((current) => (
                current
                  ? null
                  : { x: rect.left, y: rect.bottom + 8 }
              ));
            }}
          >
            {sharedCategoryId === MIXED_CATEGORY_VALUE
              ? 'Category'
              : sharedCategory
                ? `# ${sharedCategory.name}`
                : 'Category'}
          </button>
          <button
            type="button"
            className="bulk-action-btn"
            onClick={() => handleBulkCategoryAssign(null)}
            disabled={!hasSelectedCategory}
          >
            Clear category
          </button>
          <button
            type="button"
            className={`bulk-action-btn ${allSelectedPriority ? 'active' : ''}`}
            onClick={handleBulkPriorityToggle}
          >
            {allSelectedPriority ? 'Clear priority' : 'Set priority'}
          </button>
          <button
            type="button"
            className={`bulk-action-btn ${allSelectedChecked ? 'active' : ''}`}
            onClick={handleBulkCheckedToggle}
          >
            {allSelectedChecked ? 'Mark incomplete' : 'Mark complete'}
          </button>
          <button
            type="button"
            className="bulk-action-btn bulk-action-danger"
            onClick={handleBulkDelete}
          >
            Delete
          </button>
          <button
            type="button"
            className="bulk-action-btn"
            onClick={clearSelection}
          >
            Clear selection
          </button>
        </div>
      )}

      {bulkContextMenu && selectedTaskCount > 1 && (
        <ContextMenu
          x={bulkContextMenu.x}
          y={bulkContextMenu.y}
          items={bulkMenuItems}
          onClose={() => setBulkContextMenu(null)}
        />
      )}

      {bulkCategoryMenu && selectedTaskCount > 1 && (
        <ContextMenu
          x={bulkCategoryMenu.x}
          y={bulkCategoryMenu.y}
          items={bulkCategoryItems}
          onClose={() => setBulkCategoryMenu(null)}
        />
      )}

      {/* Zoom controls */}
      <div className="zoom-controls">
        <button onClick={() => zoomTo(0.8)} title="Zoom out">-</button>
        <span className="zoom-level">{Math.round(zoom * 100)}%</span>
        <button onClick={() => zoomTo(1.25)} title="Zoom in">+</button>
        <span className="zoom-sep" />
        <button onClick={fitAll} title="Fit all">F</button>
        <button onClick={() => { resetZoomTease(); setViewOffset({ x: 80, y: 30 }); setZoom(1); }} title="Reset">R</button>
        <span className="zoom-sep" />
        <button
          className={`zoom-tool-btn ${activeTool === 'area' ? 'active' : ''}`}
          onClick={() => {
            draftAreaRef.current = null;
            setDraftArea(null);
            setActiveTool(current => current === 'area' ? 'select' : 'area');
          }}
          title={activeTool === 'area' ? 'Cancel area' : 'Area'}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="6" width="16" height="12" rx="3" />
          </svg>
        </button>
        <button onClick={() => setToolbarHidden(h => !h)} title={toolbarHidden ? 'Show toolbar' : 'Hide toolbar'}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
            {toolbarHidden && <line x1="4" y1="20" x2="20" y2="4" strokeWidth="2.5" />}
          </svg>
        </button>
        <button className="theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
          {theme === 'dark' ? (
            <svg viewBox="0 0 20 20" fill="none" stroke="var(--ink-main)" strokeWidth="2" strokeLinecap="round">
              <rect x="2" y="2" width="16" height="16" rx="2" fill="var(--ink-main)" opacity="0.15" />
              <path d="M6 14 L10 6 L14 14" />
              <line x1="7" y1="12" x2="13" y2="12" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="none" stroke="var(--ink-main)" strokeWidth="2" strokeLinecap="round">
              <rect x="2" y="2" width="16" height="16" rx="2" fill="var(--ink-main)" />
              <path d="M6 14 L10 6 L14 14" stroke="var(--bg)" />
              <line x1="7" y1="12" x2="13" y2="12" stroke="var(--bg)" />
            </svg>
          )}
        </button>
        <span className="zoom-sep" />
        <div
          className={`save-indicator ${saveStatusMeta.className}`}
          role="status"
          aria-live="polite"
          aria-label={saveStatusMeta.label}
        >
          <span className="save-indicator-dot" />
          <span className="save-indicator-tooltip">{saveStatusMeta.label}</span>
        </div>
        {electronRuntime && (
          <button
            type="button"
            className={`sync-toggle ${syncInfo?.enabled ? 'active' : ''}`}
            onClick={handleSyncClick}
            title={syncInfo?.enabled
              ? `Refresh synced todos (${syncInfo.externalTaskCount || 0})`
              : 'Choose folders for tagged todo sync'}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 2l4 4-4 4" />
              <path d="M3 11V9a4 4 0 014-4h14" />
              <path d="M7 22l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
          </button>
        )}
      </div>

      {/* Hint */}
      <div className="canvas-hint">
        {activeTool === 'area'
          ? 'drag to draw area · esc to cancel'
          : 'drag to pan · scroll to zoom · double-click to label'}
      </div>
    </div>
  );
}
