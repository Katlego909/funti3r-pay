import { useEffect, useState } from 'react';
import type { Schedule } from '../api/schedules.js';
import SlideOver, { Row, SectionTitle } from './SlideOver.js';
import { StatusBadge } from './StatusBadge.js';

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

export default function ScheduleDetailModal({
  schedule,
  workers,
  onClose,
}: {
  schedule: Schedule | null;
  workers: WorkerOption[];
  onClose: () => void;
}) {
  // Keep the last non-null schedule as local state so content stays put
  // during SlideOver's slide-out animation, after the parent has already
  // nulled the `schedule` prop that triggers the close.
  const [current, setCurrent] = useState<Schedule | null>(null);
  useEffect(() => {
    if (schedule) setCurrent(schedule);
  }, [schedule]);

  if (!current) return null;

  const workerEmail = (workerId: string) => workers.find((w) => w.id === workerId)?.email ?? workerId.slice(0, 8);
  const total = current.items.reduce((s, i) => s + i.amountUsd, 0);

  return (
    <SlideOver openKey={schedule} title={current.name} onClose={onClose}>
        <div style={{ marginTop: '1rem' }}>
          <div style={{
            background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '12px',
            padding: '16px', marginBottom: '8px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.9rem', fontWeight: 800 }}>{fmtUsd(total)}</div>
            <div style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '2px' }}>per run · {current.items.length} worker{current.items.length !== 1 ? 's' : ''}</div>
            <StatusBadge variant={current.status === 'active' ? 'completed' : 'pending'} style={{ marginTop: '10px', display: 'inline-block' }}>
              {current.status === 'active' ? 'Active' : 'Paused'}
            </StatusBadge>
          </div>

          <SectionTitle>Schedule</SectionTitle>
          <Row label="Frequency">{FREQUENCY_LABELS[current.frequency] ?? current.frequency}</Row>
          <Row label="Run day">{current.frequency === 'monthly' ? `Day ${current.run_day} of month` : current.run_day.charAt(0).toUpperCase() + current.run_day.slice(1)}</Row>
          <Row label="Timezone">{current.timezone}</Row>
          <Row label="Next run">{fmtDate(current.next_run_at)}</Row>
          {current.last_run_at && (
            <Row label="Last run">
              {fmtDate(current.last_run_at)}
              {current.last_run_status && (
                <span style={{ display: 'block', color: current.last_run_status === 'failed' ? '#dc2626' : current.last_run_status === 'partial' ? '#d97706' : '#16a34a' }}>
                  {LAST_RUN_LABELS[current.last_run_status]}
                </span>
              )}
            </Row>
          )}
          <Row label="Created">{fmtDate(current.created_at)}</Row>

          <SectionTitle>Workers & amounts</SectionTitle>
          <div style={{ border: '1px solid #f1f5f9', borderRadius: '8px', overflow: 'hidden' }}>
            {current.items.map((item, i) => (
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
    </SlideOver>
  );
}
