import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}

export function LogModal({ open, onClose, onSubmit }: Props) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      setTimeout(() => textareaRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = '';
      setText('');
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText('');
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className={`log-modal${open ? ' open' : ''}`}
      aria-hidden={!open}
      aria-modal="true"
      role="dialog"
    >
      <div className="log-modal-backdrop" onClick={onClose} />
      <div className="log-modal-card">
        <div className="log-modal-header">
          <span className="log-modal-title">log food or exercise</span>
          <button className="log-modal-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="log-input-textarea"
          placeholder="e.g. 2 eggs and toast, 30 min run…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
        <div className="log-input-footer">
          <span className="log-input-status" />
          <button
            className="log-submit-btn"
            onClick={handleSubmit}
            disabled={!text.trim()}
          >
            log it
          </button>
        </div>
      </div>
    </div>
  );
}
