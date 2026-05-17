import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ContextMenu({ x, y, items, onClose }) {
  const menuRef = useRef(null);
  const itemRefs = useRef({});
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState(null);
  const [submenuDirection, setSubmenuDirection] = useState('right');

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    // Clamp to viewport
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      el.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  useEffect(() => {
    setOpenSubmenuIndex(null);
  }, [items]);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', handleClick, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handleClick, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const openSubmenu = (index) => {
    const triggerEl = itemRefs.current[index];
    if (!triggerEl) return;

    const rect = triggerEl.getBoundingClientRect();
    const estimatedWidth = 220;
    const shouldOpenLeft = rect.right + estimatedWidth > window.innerWidth - 8;

    setSubmenuDirection(shouldOpenLeft ? 'left' : 'right');
    setOpenSubmenuIndex(index);
  };

  const renderItemContent = (item, hasChildren = false) => (
    <>
      {item.swatchColor ? (
        <span
          className="ctx-swatch"
          style={{ background: item.swatchColor, borderColor: item.swatchColor }}
        />
      ) : (
        item.icon && (
          <span
            className="ctx-icon"
            style={item.iconColor ? { color: item.iconColor } : undefined}
          >
            {item.icon}
          </span>
        )
      )}
      <span className="ctx-label">{item.label}</span>
      {item.selected && <span className="ctx-check">✓</span>}
      {hasChildren && <span className="ctx-submenu-arrow">›</span>}
    </>
  );

  const renderTopLevelItem = (item, index) => {
    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
    const isOpen = openSubmenuIndex === index;

    if (!hasChildren) {
      return (
        <button
          key={index}
          className={`ctx-item ${item.danger ? 'ctx-danger' : ''} ${item.selected ? 'ctx-item-selected' : ''}`}
          onClick={() => {
            item.action?.();
            onClose();
          }}
        >
          {renderItemContent(item)}
        </button>
      );
    }

    return (
      <div
        key={index}
        className={`ctx-item-wrap ${isOpen ? 'submenu-open' : ''}`}
        onMouseEnter={() => openSubmenu(index)}
        onMouseLeave={() => setOpenSubmenuIndex((current) => (current === index ? null : current))}
      >
        <button
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          className={`ctx-item ctx-item-parent ${item.danger ? 'ctx-danger' : ''}`}
          onClick={() => openSubmenu(index)}
        >
          {renderItemContent(item, true)}
        </button>

        {isOpen && (
          <div className={`ctx-menu ctx-submenu ctx-submenu-${submenuDirection}`}>
            {item.children.map((child, childIndex) => (
              <button
                key={childIndex}
                className={`ctx-item ${child.danger ? 'ctx-danger' : ''} ${child.selected ? 'ctx-item-selected' : ''}`}
                onClick={() => {
                  child.action?.();
                  onClose();
                }}
              >
                {renderItemContent(child)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return createPortal(
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="ctx-divider" />
        ) : (
          renderTopLevelItem(item, i)
        )
      )}
    </div>,
    document.body
  );
}
