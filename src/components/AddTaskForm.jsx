import React, { useState, useCallback } from 'react';
import ContextMenu from './ContextMenu';
import PromptModal from './PromptModal';

const COLOR_PALETTE = ['#E2535B', '#8575B5', '#4A90D9', '#E87461', '#5BAE7C', '#D4A853', '#6BB5C9', '#C75D9F'];

export default function AddTaskForm({ categories, onAdd, onAddCategory, onDeleteCategory, onRenameCategory }) {
  const [text, setText] = useState('');
  const [selectedCat, setSelectedCat] = useState(null);
  const [priority, setPriority] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [ctxMenu, setCtxMenu] = useState(null);
  const [renamePrompt, setRenamePrompt] = useState(null); // { catId, currentName }

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed, selectedCat, priority);
    setText('');
    setPriority(false);
  };

  const handleAddCategory = () => {
    const name = newCatName.trim();
    if (!name) { setShowNewCat(false); return; }
    const usedColors = (categories || []).map(c => c.color);
    const nextColor = COLOR_PALETTE.find(c => !usedColors.includes(c))
      || COLOR_PALETTE[(categories || []).length % COLOR_PALETTE.length];
    onAddCategory(name, nextColor);
    setNewCatName('');
    setShowNewCat(false);
  };

  const handleCatContextMenu = useCallback((e, cat) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, cat });
  }, []);

  const colorItems = ctxMenu
    ? COLOR_PALETTE.map((color) => ({
      key: color,
      swatchColor: color,
      label: color,
      selected: ctxMenu.cat.color === color,
      action: () => onRenameCategory(ctxMenu.cat.id, ctxMenu.cat.name, color),
    }))
    : [];

  const ctxItems = ctxMenu ? [
    {
      icon: '~',
      label: 'Rename',
      action: () => {
        setRenamePrompt({ catId: ctxMenu.cat.id, currentName: ctxMenu.cat.name });
      },
    },
    {
      icon: '\u25CF',
      label: 'Color',
      children: colorItems,
    },
    { divider: true },
    {
      icon: 'x',
      label: 'Delete',
      danger: true,
      action: () => {
        if (selectedCat === ctxMenu.cat.id) setSelectedCat(null);
        onDeleteCategory(ctxMenu.cat.id);
      },
    },
  ] : [];

  return (
    <div className="input-section">
      <span className="anno-input">dump ideas here -&gt;</span>

      <div className="input-row">
        <input
          type="text"
          className={`input-box ${focused ? 'focused' : ''}`}
          placeholder="Add a task..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <button className="btn-add" onClick={handleSubmit} aria-label="Add Task">
          <svg viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <div className="category-row">
        {(categories || []).map(cat => (
          <button
            key={cat.id}
            className={`cat-chip ${selectedCat === cat.id ? 'selected' : ''}`}
            style={{
              borderColor: selectedCat === cat.id ? cat.color : undefined,
              color: selectedCat === cat.id ? cat.color : undefined,
            }}
            onClick={() => setSelectedCat(selectedCat === cat.id ? null : cat.id)}
            onContextMenu={(e) => handleCatContextMenu(e, cat)}
          >
            {cat.name}
          </button>
        ))}

        {!showNewCat ? (
          <button className="cat-chip new-cat" onClick={() => setShowNewCat(true)}>+</button>
        ) : (
          <input
            autoFocus
            className="new-cat-input"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddCategory();
              if (e.key === 'Escape') { setShowNewCat(false); setNewCatName(''); }
            }}
            onBlur={() => {
              if (!newCatName.trim()) setShowNewCat(false);
              else handleAddCategory();
            }}
            placeholder="new category..."
          />
        )}

        <button
          className={`priority-toggle ${priority ? 'active' : ''}`}
          onClick={() => setPriority(!priority)}
          title="Priority"
        >
          !!!
        </button>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {renamePrompt && (
        <PromptModal
          title="Rename category"
          defaultValue={renamePrompt.currentName}
          onConfirm={(newName) => {
            if (newName !== renamePrompt.currentName) {
              onRenameCategory(renamePrompt.catId, newName);
            }
            setRenamePrompt(null);
          }}
          onCancel={() => setRenamePrompt(null)}
        />
      )}
    </div>
  );
}
