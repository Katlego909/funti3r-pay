import { useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { HiXMark } from 'react-icons/hi2';

interface SlideOverProps {
  /** Falsy hides the panel; a truthy value (re)opens it, keyed on reference/value changes. */
  openKey: unknown;
  title: ReactNode;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}

/**
 * Shared slide-in-from-the-right panel shell: mount/visible/close-timer
 * state machine, backdrop, Escape-to-close, and the header row. Used by the
 * payment/schedule/worker detail panels so the close-timer-cancellation
 * guard (rapid re-open shouldn't let a stale timeout self-close the new
 * panel) only has to be correct in one place.
 */
export default function SlideOver({ openKey, title, onClose, width = 460, children }: SlideOverProps) {
  // mounted = in the DOM (kept during slide-out); visible = slid into view.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!openKey) return;
    // Cancel any in-flight close timer so a rapid re-open doesn't self-destruct.
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setMounted(true);
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [openKey]);

  const handleClose = useCallback(() => {
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setMounted(false);
      onClose();
    }, 220);
  }, [onClose]);

  // Close on Escape.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, handleClose]);

  if (!mounted) return null;

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: `rgba(15,23,42,${visible ? 0.4 : 0})`,
        transition: 'background 0.25s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', top: 0, right: 0, height: '100vh',
          width: `min(${width}px, 94vw)`, background: '#fff',
          boxShadow: '-10px 0 40px rgba(0,0,0,0.18)',
          overflowY: 'auto', padding: '1.5rem',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 1001,
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={handleClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <HiXMark size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Label/value row used throughout the detail slide-overs. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ color: '#6b7280', fontSize: '0.82rem' }}>{label}</span>
      <span style={{ fontSize: '0.85rem', fontWeight: 500, textAlign: 'right', wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

/** Uppercase section divider used throughout the detail slide-overs. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 style={{ margin: '20px 0 6px', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#6b7280' }}>{children}</h4>;
}
