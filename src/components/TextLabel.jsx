import React, { useState, useEffect, useRef, useCallback } from 'react';
import ContextMenu from './ContextMenu';

const ROTATIONS = [0, 4, 8, -8, -4];
const SIZES = [1.4, 1.8, 2.2, 2.6, 3.2, 4.0];
const DEFAULT_SIZE = 2.6;

function hexToRgba(hex, alpha) {
  const normalized = (hex || '').replace('#', '');
  if (normalized.length !== 6) return `rgba(74, 144, 217, ${alpha})`;

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function TextLabel({
  label,
  onUpdate,
  onPatch,
  onDelete,
  onDragStart,
  isDragging,
  colorOptions = [],
  opacityOptions = [],
}) {
  const [editing, setEditing] = useState(label.editing || false);
  const [text, setText] = useState(label.text);
  const [ctxMenu, setCtxMenu] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const handleFinish = () => {
    setEditing(false);
    onUpdate(label.id, text);
  };

  const handleContextMenu = useCallback((e) => {
    if (editing) return;
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, [editing]);

  const currentSize = label.size || DEFAULT_SIZE;
  const currentRotate = label.rotate || 0;
  const currentColor = label.color ?? null;
  const currentOpacity = typeof label.opacity === 'number'
    ? label.opacity
    : (label.faded ? 0.28 : 1);
  const resolvedColor = currentColor || 'var(--ink-main)';

  const sizeIdx = SIZES.indexOf(currentSize);
  const colorItems = colorOptions.map((option) => ({
    swatchColor: option.swatchColor || option.value || 'var(--ink-main)',
    label: option.label,
    selected: Object.is(currentColor, option.value),
    action: () => onPatch(label.id, { color: option.value }),
  }));
  const opacityItems = opacityOptions.map((option) => ({
    swatchColor: currentColor
      ? hexToRgba(currentColor, option.value)
      : (option.value === 1
        ? 'var(--ink-main)'
        : `color-mix(in srgb, var(--ink-main) ${Math.round(option.value * 100)}%, transparent)`),
    label: option.label,
    selected: Object.is(currentOpacity, option.value),
    action: () => onPatch(label.id, { opacity: option.value }),
  }));

  const ctxItems = ctxMenu ? [
    {
      icon: '~',
      label: 'Edit',
      action: () => setEditing(true),
    },
    { divider: true },
    {
      icon: '\u21BB',
      label: `Rotate (${currentRotate > 0 ? '+' : ''}${currentRotate})`,
      action: () => {
        const ri = ROTATIONS.indexOf(currentRotate);
        const next = ROTATIONS[(ri + 1) % ROTATIONS.length];
        onPatch(label.id, { rotate: next });
      },
    },
    {
      icon: '\u25CF',
      label: 'Color',
      children: colorItems,
    },
    {
      icon: '\u25D0',
      label: 'Opacity',
      children: opacityItems,
    },
    { divider: true },
    {
      icon: 'A+',
      label: 'Increase size',
      action: () => {
        const ni = Math.min(SIZES.length - 1, (sizeIdx >= 0 ? sizeIdx : 3) + 1);
        onPatch(label.id, { size: SIZES[ni] });
      },
    },
    {
      icon: 'A-',
      label: 'Decrease size',
      action: () => {
        const ni = Math.max(0, (sizeIdx >= 0 ? sizeIdx : 3) - 1);
        onPatch(label.id, { size: SIZES[ni] });
      },
    },
    { divider: true },
    {
      icon: 'x',
      label: 'Delete',
      danger: true,
      action: () => onDelete(label.id),
    },
  ] : [];

  const labelStyle = {
    position: 'absolute',
    left: label.x,
    top: label.y,
    zIndex: isDragging ? 100 : 1,
    fontSize: `${currentSize}rem`,
    transform: currentRotate ? `rotate(${currentRotate}deg)` : undefined,
    color: resolvedColor,
    opacity: currentOpacity,
    transition: 'opacity 0.3s, transform 0.2s, font-size 0.2s, color 0.2s',
  };

  return (
    <div
      className={`text-label ${isDragging ? 'dragging' : ''}`}
      style={labelStyle}
      onPointerDown={(e) => {
        if (editing || e.target.tagName === 'INPUT') return;
        onDragStart(e, label.id, 'label');
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
      }}
      onContextMenu={handleContextMenu}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="label-input"
          style={{
            fontSize: `${currentSize}rem`,
            color: resolvedColor,
          }}
          value={text}
          onChange={(e) => setText(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFinish();
            if (e.key === 'Escape') { setText(label.text); setEditing(false); }
          }}
          onBlur={handleFinish}
          placeholder="TYPE LABEL..."
        />
      ) : (
        <span className="label-text">{(label.text || '').toUpperCase()}</span>
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
