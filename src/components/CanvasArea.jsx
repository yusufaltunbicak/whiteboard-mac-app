import React, { useCallback, useMemo, useState } from 'react';
import ContextMenu from './ContextMenu';

function hexToRgba(hex, alpha) {
  const normalized = (hex || '').replace('#', '');
  if (normalized.length !== 6) return `rgba(74, 144, 217, ${alpha})`;

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function CanvasArea({
  area,
  isSelected,
  onSelect,
  onPatch,
  onDelete,
  onDragStart,
  colorOptions,
  opacityOptions,
}) {
  const [ctxMenu, setCtxMenu] = useState(null);

  const fillColor = useMemo(
    () => hexToRgba(area.color, area.opacity),
    [area.color, area.opacity],
  );
  const borderColor = useMemo(
    () => hexToRgba(area.color, Math.min(area.opacity + 0.16, 0.42)),
    [area.color, area.opacity],
  );

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(area.id);
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, [area.id, onSelect]);

  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    onSelect(area.id);
    if (area.locked) return;
    onDragStart(e, area.id, 'area');
  }, [area.id, area.locked, onDragStart, onSelect]);

  const colorItems = colorOptions.map((color) => ({
    swatchColor: color,
    label: color,
    selected: area.color === color,
    action: () => onPatch(area.id, { color }),
  }));

  const opacityItems = opacityOptions.map((option) => ({
    swatchColor: hexToRgba(area.color, option.value),
    label: option.label,
    selected: Object.is(area.opacity, option.value),
    action: () => onPatch(area.id, { opacity: option.value }),
  }));

  const ctxItems = ctxMenu ? [
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
      icon: area.locked ? '\u21BA' : '\u21F3',
      label: area.locked ? 'Unlock' : 'Lock',
      action: () => onPatch(area.id, { locked: !area.locked }),
    },
    { divider: true },
    {
      icon: 'x',
      label: 'Delete',
      danger: true,
      action: () => onDelete(area.id),
    },
  ].filter(Boolean) : [];

  return (
    <>
      <div
        className={`canvas-area ${isSelected ? 'selected' : ''} ${area.locked ? 'locked' : ''}`}
        style={{
          left: area.x,
          top: area.y,
          width: area.width,
          height: area.height,
          background: `linear-gradient(180deg, ${hexToRgba(area.color, Math.min(area.opacity + 0.04, 0.28))} 0%, ${fillColor} 100%)`,
          borderColor,
        }}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
      />

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

export function AreaSelectionOverlay({ area, onResizeStart, isDraft = false }) {
  return (
    <div
      className={`area-selection-overlay ${area.locked ? 'locked' : ''} ${isDraft ? 'draft' : ''}`}
      style={{
        left: area.x,
        top: area.y,
        width: area.width,
        height: area.height,
        borderColor: hexToRgba(area.color, isDraft ? 0.72 : 0.95),
        color: hexToRgba(area.color, isDraft ? 0.72 : 0.95),
        boxShadow: `0 0 0 1px ${hexToRgba(area.color, isDraft ? 0.12 : 0.18)}`,
      }}
    >
      {!isDraft && !area.locked && ['nw', 'ne', 'se', 'sw'].map((handle) => (
        <button
          key={handle}
          type="button"
          className={`area-overlay-handle area-overlay-handle-${handle}`}
          onPointerDown={(e) => onResizeStart(e, area.id, handle)}
          aria-label={`Resize ${handle}`}
        />
      ))}
    </div>
  );
}
