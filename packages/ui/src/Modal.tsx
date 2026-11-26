import { ReactNode, useEffect } from 'react';
import { HiOutlineXMark } from 'react-icons/hi2';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Renders the title in a header row with an ✕ close button. */
  closeButton?: boolean;
  maxWidth?: string;
  children: ReactNode;
}

/** Shared overlay + card shell: click-outside and Escape both close. */
export default function Modal({ open, onClose, title, closeButton = false, maxWidth, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={maxWidth ? { maxWidth } : undefined}>
        {title && (closeButton ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
              <HiOutlineXMark size={20} />
            </button>
          </div>
        ) : (
          <h3>{title}</h3>
        ))}
        {children}
      </div>
    </div>
  );
}
