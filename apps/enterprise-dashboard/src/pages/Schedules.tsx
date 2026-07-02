import { useEffect, useState, FormEvent } from 'react';
import { HiOutlineClock, HiOutlinePause, HiOutlinePlay, HiOutlineTrash, HiOutlinePlus, HiOutlineXMark } from 'react-icons/hi2';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/authStore.js';
import {
  listSchedules, createSchedule, updateScheduleStatus, deleteSchedule,
  type Schedule, type ScheduleItem,
} from '../api/schedules.js';

interface WorkerOption { id: string; email: string; preferred_currency?: string }
interface ScheduleRow { workerId: string; amountUsd: string }

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const MONTH_DAYS = ['1', '5', '10', '15', '20', '25', '28'];

function formatNextRun(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function totalUsd(items: ScheduleItem[]): number {
  return items.reduce((s, i) => s + i.amountUsd, 0);
}

function statusBadge(s: Schedule) {
  if (s.status === 'paused') return <span className="status pending">Paused</span>;
  if (s.last_run_status === 'failed') return <span className="status failed">Last run failed</span>;
  if (s.last_run_status === 'partial') return <span className="status pending">Last run partial</span>;
  return <span className="status completed">Active</span>;
}

export default function Schedules() {
  const user = useAuthStore((s) => s.user);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('monthly');
  const [runDay, setRunDay] = useState('1');
  const [timezone, setTimezone] = useState(() =>
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [rows, setRows] = useState<ScheduleRow[]>([{ workerId: '', amountUsd: '' }]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      listSchedules().then(setSchedules),
      api.get<{ users?: WorkerOption[] }>('/users?role=worker&limit=100')
        .then((r) => setWorkers(r.data.users ?? [])),
    ])
      .catch(() => toast.error('Failed to load schedules'))
      .finally(() => setLoading(false));
  }, [user]);

  function openForm() {
    setName('');
    setFrequency('monthly');
    setRunDay('1');
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setRows([{ workerId: '', amountUsd: '' }]);
    setFormOpen(true);
  }

  function updateRow(i: number, patch: Partial<ScheduleRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const items = rows
      .filter((r) => r.workerId && r.amountUsd && Number(r.amountUsd) > 0)
      .map((r) => ({ workerId: r.workerId, amountUsd: Number(r.amountUsd) }));

    if (items.length === 0) {
      toast.error('Add at least one worker with a positive amount.');
      return;
    }

    setSubmitting(true);
    try {
      await createSchedule({ name, frequency, runDay, timezone, items });
      toast.success(`Schedule "${name}" created`);
      setFormOpen(false);
      const updated = await listSchedules();
      setSchedules(updated);
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? err?.message ?? 'Failed to create schedule');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(schedule: Schedule) {
    const next = schedule.status === 'active' ? 'paused' : 'active';
    try {
      await updateScheduleStatus(schedule.id, next);
      setSchedules((prev) =>
        prev.map((s) => (s.id === schedule.id ? { ...s, status: next } : s)),
      );
      toast.success(`Schedule ${next === 'active' ? 'resumed' : 'paused'}`);
    } catch {
      toast.error('Failed to update schedule');
    }
  }

  async function handleDelete(schedule: Schedule) {
    if (!confirm(`Delete "${schedule.name}"? This cannot be undone.`)) return;
    try {
      await deleteSchedule(schedule.id);
      setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
      toast.success('Schedule deleted');
    } catch {
      toast.error('Failed to delete schedule');
    }
  }

  const runDayOptions = frequency === 'monthly' ? MONTH_DAYS : WEEKDAYS;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Schedules</h2>
          <p className="subtitle">Automate recurring payroll runs</p>
        </div>
        <button className="btn-cta" onClick={openForm}>
          New Schedule
        </button>
      </div>

      {/* Create modal */}
      {formOpen && (
        <div className="modal-overlay" onClick={() => setFormOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ margin: 0 }}>New Payroll Schedule</h3>
              <button onClick={() => setFormOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
                <HiOutlineXMark size={20} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="payment-form">
              <label>Schedule name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Monthly staff payroll"
                  required
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <label>Frequency
                  <select value={frequency} onChange={(e) => {
                    const f = e.target.value as typeof frequency;
                    setFrequency(f);
                    setRunDay(f === 'monthly' ? '1' : 'friday');
                  }}>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>

                <label>{frequency === 'monthly' ? 'Day of month' : 'Day of week'}
                  <select value={runDay} onChange={(e) => setRunDay(e.target.value)}>
                    {runDayOptions.map((d) => (
                      <option key={d} value={d}>
                        {frequency === 'monthly' ? `${d}${['1','21'].includes(d) ? 'st' : ['2','22'].includes(d) ? 'nd' : ['3','23'].includes(d) ? 'rd' : 'th'}` : d.charAt(0).toUpperCase() + d.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>Timezone
                <input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="e.g. Africa/Johannesburg"
                />
              </label>

              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b7280', marginTop: '4px' }}>
                Workers & amounts (USD)
              </div>

              {rows.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select
                    style={{ flex: 2, minWidth: 0 }}
                    value={row.workerId}
                    onChange={(e) => updateRow(i, { workerId: e.target.value })}
                  >
                    <option value="">Select worker…</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>{w.email}</option>
                    ))}
                  </select>
                  <input
                    type="number" min="0.01" step="0.01" placeholder="USD"
                    style={{ width: '100px' }}
                    value={row.amountUsd}
                    onChange={(e) => updateRow(i, { amountUsd: e.target.value })}
                  />
                  <button
                    type="button"
                    disabled={rows.length <= 1}
                    onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
                    style={{ width: '32px', height: '32px', flexShrink: 0, border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', color: '#ef4444', cursor: rows.length > 1 ? 'pointer' : 'not-allowed', opacity: rows.length > 1 ? 1 : 0.4 }}
                  >
                    ✕
                  </button>
                </div>
              ))}

              <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start' }}
                onClick={() => setRows((r) => [...r, { workerId: '', amountUsd: '' }])}>
                + Add worker
              </button>

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={submitting || !name.trim()}>
                  {submitting ? 'Creating…' : 'Create Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading schedules…</div>
      ) : schedules.length === 0 ? (
        <section className="section" style={{ textAlign: 'center', padding: '3rem' }}>
          <HiOutlineClock size={40} style={{ color: '#d1d5db', margin: '0 auto 12px' }} />
          <p style={{ color: '#6b7280', marginBottom: '1rem' }}>No payroll schedules yet.</p>
          <button className="btn-primary" onClick={openForm}>Create your first schedule</button>
        </section>
      ) : (
        <section className="section">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Frequency</th>
                <th>Workers</th>
                <th>Total / run</th>
                <th>Next run</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{FREQUENCY_LABELS[s.frequency]}</td>
                  <td>{s.items.length} worker{s.items.length !== 1 ? 's' : ''}</td>
                  <td>${totalUsd(s.items).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td>{formatNextRun(s.next_run_at)}</td>
                  <td>{statusBadge(s)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        title={s.status === 'active' ? 'Pause' : 'Resume'}
                        onClick={() => handleToggle(s)}
                        style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: '#6b7280' }}
                      >
                        {s.status === 'active'
                          ? <HiOutlinePause size={15} />
                          : <HiOutlinePlay size={15} />}
                      </button>
                      <button
                        title="Delete"
                        onClick={() => handleDelete(s)}
                        style={{ background: 'none', border: '1px solid #fecaca', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: '#ef4444' }}
                      >
                        <HiOutlineTrash size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
