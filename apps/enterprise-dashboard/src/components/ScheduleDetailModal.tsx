import { useEffect, useState, useCallback, useRef } from 'react';
import { HiXMark } from 'react-icons/hi2';
import type { Schedule } from '../api/schedules.js';

interface WorkerOption { id: string; email: string; preferred_currency?: string }

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
};

const LAST_RUN_LABELS: Record<string, string> = {
  success: 'Succeeded',
  partial: 'Partially succeeded',
  failed: 'Failed',
};

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');
const fmtUsd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ color: '#6b7280', fontSize: '0.82rem' }}>{label}</span>
      <span style={{ fontSize: '0.85rem', fontWeight: 500, textAlign: 'right', wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 style={{ margin: '20px 0 6px', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#6b7280' }}>{children}</h4>;
}

export default function ScheduleDetailModal({
  schedule,
  workers,
  onClose,
}: {
  schedule: Schedule | null;
  workers: WorkerOption[];
  onClose: () => void;
}) {
  // mounted = in the DOM (kept during slide-out); visible = slid into view.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!schedule) return;
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setMounted(true);
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [schedule]);

  const handleClose = useCallback(() => {
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setMounted(false);
      onClose();
    }, 220);
  }, [onClose]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, handleClose]);

  if (!mounted || !schedule) return null;

  const workerEmail = (workerId: string) => workers.find((w) => w.id === workerId)?.email ?? workerId.slice(0, 8);
  const total = schedule.items.reduce((s, i) => s + i.amountUsd, 0);

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
          width: 'min(460px, 92vw)', background: '#fff',
          boxShadow: '-10px 0 40px rgba(0,0,0,0.18)',
          overflowY: 'auto', padding: '1.5rem',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 1001,
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h3 style={{ margin: 0 }}>{schedule.name}</h3>
          <button onClick={handleClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <HiXMark size={22} />
          </button>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <div style={{
            background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '12px',
            padding: '16px', marginBottom: '8px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.9rem', fontWeight: 800 }}>{fmtUsd(total)}</div>
            <div style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '2px' }}>per run · {schedule.items.length} worker{schedule.items.length !== 1 ? 's' : ''}</div>
            <span className={`status ${schedule.status === 'active' ? 'completed' : 'pending'}`} style={{ marginTop: '10px', display: 'inline-block' }}>
              {schedule.status === 'active' ? 'Active' : 'Paused'}
            </span>
          </div>

          <SectionTitle>Schedule</SectionTitle>
          <Row label="Frequency">{FREQUENCY_LABELS[schedule.frequency] ?? schedule.frequency}</Row>
          <Row label="Run day">{schedule.frequency === 'monthly' ? `Day ${schedule.run_day} of month` : schedule.run_day.charAt(0).toUpperCase() + schedule.run_day.slice(1)}</Row>
          <Row label="Timezone">{schedule.timezone}</Row>
          <Row label="Next run">{fmtDate(schedule.next_run_at)}</Row>
          {schedule.last_run_at && (
            <Row label="Last run">
              {fmtDate(schedule.last_run_at)}
              {schedule.last_run_status && (
                <span style={{ display: 'block', color: schedule.last_run_status === 'failed' ? '#dc2626' : schedule.last_run_status === 'partial' ? '#d97706' : '#16a34a' }}>
                  {LAST_RUN_LABELS[schedule.last_run_status]}
                </span>
              )}
            </Row>
          )}
          <Row label="Created">{fmtDate(schedule.created_at)}</Row>

          <SectionTitle>Workers & amounts</SectionTitle>
          <div style={{ border: '1px solid #f1f5f9', borderRadius: '8px', overflow: 'hidden' }}>
            {schedule.items.map((item, i) => (
              <div
                key={`${item.workerId}-${i}`}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', fontSize: '0.85rem',
                  borderTop: i > 0 ? '1px solid #f1f5f9' : undefined,
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{workerEmail(item.workerId)}</div>
                  {item.memo && <div style={{ color: '#9ca3af', fontSize: '0.76rem' }}>{item.memo}</div>}
                </div>
                <div style={{ fontWeight: 600 }}>{fmtUsd(item.amountUsd)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
