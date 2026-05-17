import React, { useState, useCallback } from 'react';
import ContextMenu from './ContextMenu';

const ROTATIONS = [
  'rotate(-1.5deg)',
  'rotate(2deg)',
  'rotate(-0.5deg)',
  'rotate(1.2deg)',
  'rotate(-2deg)',
];

const RADII = [
  '255px 15px 225px 15px/15px 225px 15px 255px',
  '15px 255px 15px 225px/225px 15px 255px 15px',
  '225px 15px 255px 15px/15px 225px 15px 255px',
  '15px 225px 15px 255px/255px 15px 225px 15px',
  '255px 25px 225px 25px/25px 225px 25px 255px',
];

export default function TaskCard({
  task, index, category, categories, selected, onToggle, onDelete, onUpdateNote, onPatch, onDragStart, isDragging,
  onTaskPointerDown, onTaskContextMenu, onHoverStart, onHoverEnd, isExternal = false,
}) {
  const [hovered, setHovered] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(task.note || '');
  const [editingText, setEditingText] = useState(false);
  const [textValue, setTextValue] = useState(task.text);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [categoryMenu, setCategoryMenu] = useState(null);

  const i = index % 5;
  const borderColor = task.priority ? 'var(--ink-accent)' : (category?.color || 'var(--ink-main)');
  const borderWidth = task.priority ? '3px' : '2px';
  const baseTransform = ROTATIONS[i];
  const cardTransform = hovered && !isDragging ? `${baseTransform} scale(1.02)` : baseTransform;
  const cardShadow = isDragging
    ? 'none'
    : selected
      ? '0 0 0 4px var(--selection-ring), 10px 10px 0px var(--toolbar-shadow)'
    : hovered
      ? '8px 8px 0px var(--toolbar-shadow)'
      : 'none';

  const cardStyle = {
    position: 'absolute',
    left: task.x || 0,
    top: task.y || 0,
    width: 300,
    padding: '1.5rem',
    border: `${borderWidth} solid ${borderColor}`,
    borderRadius: RADII[i],
    background: 'var(--bg-card)',
    cursor: isDragging ? 'grabbing' : 'grab',
    transform: cardTransform,
    boxShadow: cardShadow,
    outline: selected ? '2px solid var(--selection-ring)' : 'none',
    outlineOffset: isDragging ? 1 : 0,
    transition: isDragging ? 'none' : 'transform 0.2s, box-shadow 0.2s',
    zIndex: isDragging ? 100 : (selected ? 4 : (hovered ? 2 : 1)),
    userSelect: 'none',
    touchAction: 'none',
  };

  const handleNoteFinish = () => {
    onUpdateNote(task.id, noteText.trim() || null);
    setEditingNote(false);
  };

  const handleTextFinish = () => {
    const trimmed = textValue.trim();
    if (trimmed && trimmed !== task.text) {
      onPatch(task.id, { text: trimmed });
    } else {
      setTextValue(task.text);
    }
    setEditingText(false);
  };

  const handleContextMenu = useCallback((e) => {
    if (editingText || editingNote) return;
    const handled = onTaskContextMenu?.(e, task);
    if (handled) {
      setCtxMenu(null);
      setCategoryMenu(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setCategoryMenu(null);
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, [editingText, editingNote, onTaskContextMenu, task]);

  const openCategoryMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu(null);
    const rect = e.currentTarget.getBoundingClientRect();
    setCategoryMenu({
      x: rect.right + 10,
      y: rect.top - 6,
    });
  }, []);

  const categoryItems = [
    {
      icon: '∅',
      label: 'Uncategorized',
      selected: task.category == null,
      action: () => onPatch(task.id, { category: null }),
    },
    ...((categories || []).map((cat) => ({
      swatchColor: cat.color,
      label: cat.name,
      selected: task.category === cat.id,
      action: () => onPatch(task.id, { category: cat.id }),
    }))),
  ];

  // Build context menu items
  const ctxItems = ctxMenu ? [
    ...(!isExternal ? [{
      icon: '~',
      label: 'Edit',
      action: () => { setTextValue(task.text); setEditingText(true); },
    }] : []),
    {
      icon: '*',
      label: task.note ? 'Edit note' : 'Add note',
      action: () => { setNoteText(task.note || ''); setEditingNote(true); },
    },
    { divider: true },
    {
      icon: task.priority ? '\u2606' : '\u2605',
      label: task.priority ? 'Clear priority' : 'Set priority',
      action: () => onPatch(task.id, { priority: !task.priority }),
    },
    {
      icon: '#',
      label: category ? `Category: ${category.name}` : 'Category',
      children: categoryItems,
    },
    {
      icon: task.checked ? '\u25CB' : '\u2713',
      label: task.checked ? 'Mark incomplete' : 'Mark complete',
      action: () => onToggle(task.id),
    },
    { divider: true },
    {
      icon: 'x',
      label: 'Delete',
      danger: true,
      action: () => onDelete(task.id),
    },
  ] : [];

  return (
    <div
      className={`task-card ${isDragging ? 'dragging' : ''}`}
      style={cardStyle}
      onMouseEnter={() => {
        setHovered(true);
        onHoverStart?.(task.id);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHoverEnd?.(task.id);
      }}
      onPointerDown={(e) => {
        if (e.target.closest('input, button, .note-area')) return;
        if (onTaskPointerDown) {
          onTaskPointerDown(e, task);
          return;
        }
        onDragStart(e, task.id, 'task');
      }}
      onContextMenu={handleContextMenu}
    >
      {/* Priority badge */}
      {task.priority && (
        <span style={{
          fontFamily: "'Caveat', cursive", color: 'var(--ink-accent)', fontSize: '1.3rem',
          position: 'absolute', top: -25, right: -10,
          transform: 'rotate(8deg)', pointerEvents: 'none',
        }}>
          ASAP!!
        </span>
      )}

      {/* Header: checkbox + text */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.3rem' }}>
        <div className="checkbox-wrap">
          <input
            type="checkbox"
            checked={task.checked}
            onChange={() => onToggle(task.id)}
          />
          <div className="drawn-circle" />
          <svg viewBox="0 0 24 24" style={{
            position: 'absolute', top: '15%', left: '15%', width: '70%', height: '70%',
            stroke: 'var(--ink-main)', strokeWidth: 4, fill: 'none',
            strokeLinecap: 'round', strokeLinejoin: 'round',
            strokeDasharray: 50,
            strokeDashoffset: task.checked ? 0 : 50,
            transition: 'stroke-dashoffset 0.3s cubic-bezier(0.4,0,0.2,1)',
          }}>
            <path d="M4 10 L10 16 L22 4" />
          </svg>
        </div>

        <div style={{ width: '100%' }}>
          {editingText ? (
            <input
              autoFocus
              className="note-input"
              style={{
                fontFamily: "'Kalam', cursive",
                fontSize: '1.6rem',
                color: 'var(--ink-main)',
                borderBottomColor: 'var(--ink-main)',
                marginTop: 0,
              }}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTextFinish();
                if (e.key === 'Escape') { setTextValue(task.text); setEditingText(false); }
              }}
              onBlur={handleTextFinish}
            />
          ) : (
            <span style={{
              fontFamily: "'Kalam', cursive", fontSize: '1.6rem', lineHeight: 1.2,
              color: 'var(--ink-main)',
              opacity: task.checked ? 0.45 : 1, transition: 'opacity 0.2s',
              textDecorationLine: task.checked ? 'line-through' : 'none',
              textDecorationThickness: '3px',
              textDecorationColor: 'var(--ink-main)',
              display: 'inline',
            }}>
              {task.text}
            </span>
          )}
        </div>
      </div>

      {/* Meta row: tag */}
      {category && (
        <div style={{ marginTop: '0.4rem' }}>
          <button
            type="button"
            className="task-category-chip"
            onClick={openCategoryMenu}
            title="Category"
            style={{
              color: category.color,
              borderColor: `${category.color}50`,
            }}
          >
            {category.name}
          </button>
        </div>
      )}

      {/* Note display */}
      <div className="note-area">
        {task.note && !editingNote && (
          <span
            style={{
              fontFamily: "'Caveat', cursive", color: 'var(--ink-note)', fontSize: '1.15rem',
              display: 'block', marginTop: '0.4rem',
              transform: 'rotate(-2deg)',
            }}
          >
            *{task.note}
          </span>
        )}

        {editingNote && (
          <input
            autoFocus
            className="note-input"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNoteFinish();
              if (e.key === 'Escape') { setNoteText(task.note || ''); setEditingNote(false); }
            }}
            onBlur={handleNoteFinish}
            placeholder="add note..."
          />
        )}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {categoryMenu && (
        <ContextMenu
          x={categoryMenu.x}
          y={categoryMenu.y}
          items={categoryItems}
          onClose={() => setCategoryMenu(null)}
        />
      )}
    </div>
  );
}
