import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function PromptModal({ title, defaultValue, onConfirm, onCancel }) {
  const [value, setValue] = useState(defaultValue || '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
    else onCancel();
  };

  return createPortal(
    <div className="prompt-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="prompt-box">
        <span className="prompt-title">{title}</span>
        <input
          ref={inputRef}
          className="prompt-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
        />
        <div className="prompt-actions">
          <button className="prompt-btn prompt-cancel" onClick={onCancel}>Cancel</button>
          <button className="prompt-btn prompt-confirm" onClick={handleSubmit}>Confirm</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
