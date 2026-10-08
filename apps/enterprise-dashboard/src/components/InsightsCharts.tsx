import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts';
import type { Payment } from '../api/payments.js';
import type { DisplayCurrency } from '../lib/displayCurrency.js';

const WORKER_COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const STATUS_COLORS: Record<string, string> = {
  completed: '#16a34a', failed: '#dc2626', pending: '#d97706',
  initiated: '#7c3aed', submitted: '#7c3aed', cancelled: '#9ca3af',
};

/** How money reached the worker — shown instead of a per-asset breakdown. */
export const RAIL_LABELS: Record<string, string> = {
  stellar: 'Direct payment',
  anchor: 'Bank / cash payout',
  escrow: 'Escrow milestone',
};
const RAIL_COLORS: Record<string, string> = { stellar: '#6366f1', anchor: '#06b6d4', escrow: '#16a34a' };

/** A payment's value in the viewer's display currency (0 when it can't be priced). */
const valueOf = (p: Payment, dc: DisplayCurrency) => dc.convert(Number(p.amount), p.currency) ?? 0;

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function dailyVolume(payments: Payment[], dc: DisplayCurrency, days = 14) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const buckets: Record<string, number> = {};
  const order: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = localKey(d);
    buckets[key] = 0;
    order.push(key);
  }
  for (const p of payments) {
    if (p.status !== 'completed') continue;
    const key = localKey(new Date(p.created_at));
    if (key in buckets) buckets[key] += valueOf(p, dc);
  }
  return order.map((key) => ({
    date: new Date(key + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    value: round2(buckets[key]),
  }));
}

function monthlyVolume(payments: Payment[], dc: DisplayCurrency, months = 6) {
  const today = new Date();
  const result: { month: string; value: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    result.push({ month: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), value: 0 });
  }
  for (const p of payments) {
    if (p.status !== 'completed') continue;
    const d = new Date(p.created_at);
    const idx = (d.getFullYear() - today.getFullYear()) * 12 + d.getMonth() - today.getMonth() + (months - 1);
    if (idx >= 0 && idx < months) result[idx].value += valueOf(p, dc);
  }
  return result.map((r) => ({ ...r, value: round2(r.value) }));
}

function topWorkersByVolume(payments: Payment[], dc: DisplayCurrency, limit = 7) {
  const totals: Record<string, { name: string; value: number }> = {};
  for (const p of payments) {
    if (p.status !== 'completed') continue;
    const key = p.worker_id;
    const name = p.worker_email?.split('@')[0] ?? p.worker_id.slice(0, 8);
    if (!totals[key]) totals[key] = { name, value: 0 };
    totals[key].value += valueOf(p, dc);
  }
  return Object.values(totals)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((w) => ({ ...w, value: round2(w.value) }));
}

/** Completed volume per rail (direct / bank-cash / escrow), in the display currency. */
function volumeByRail(payments: Payment[], dc: DisplayCurrency) {
  const totals: Record<string, number> = {};
  for (const p of payments) {
    if (p.status !== 'completed') continue;
    totals[p.rail] = (totals[p.rail] ?? 0) + valueOf(p, dc);
  }
  return Object.entries(totals)
    .map(([rail, value]) => ({ key: rail, name: RAIL_LABELS[rail] ?? rail, value: round2(value) }))
    .filter((d) => d.value > 0);
}

export default function InsightsCharts({
  payments, dc, byStatus = {}, isWorker = false,
}: {
  payments: Payment[];
  dc: DisplayCurrency;
  byStatus?: Record<string, number>;
  isWorker?: boolean;
}) {
  const series = dailyVolume(payments, dc);
  const monthly = monthlyVolume(payments, dc);
  const hasVolume = series.some((d) => d.value > 0);
  const hasMonthly = monthly.some((d) => d.value > 0);

  const statusData = Object.entries(byStatus)
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0);
  const railData = volumeByRail(payments, dc);
  const topWorkers = isWorker ? [] : topWorkersByVolume(payments, dc);

  const chartColor = isWorker ? '#16a34a' : '#7c3aed';
  const chartTitle = isWorker ? `Received (${dc.code} · 14 days)` : `Payout Volume (${dc.code} · 14 days)`;
  const emptyText = isWorker
    ? 'No payments received in the last 14 days.'
    : 'No completed payouts in the last 14 days.';
  const axis = (v: number) => dc.formatValue(Number(v)).replace(/\.00$/, '');

  const statusPie = (
    <section className="section">
      <h3>Payments by Status</h3>
      {statusData.length > 0 ? (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius={55} outerRadius={82} paddingAngle={2}>
              {statusData.map((d) => (
                <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? '#9ca3af'} />
              ))}
            </Pie>
            <Tooltip formatter={(v, n) => [Number(v), String(n)]} />
            <Legend verticalAlign="bottom" height={24} iconType="circle"
              formatter={(v) => <span style={{ fontSize: 12, textTransform: 'capitalize', color: '#374151' }}>{v}</span>} />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <p className="empty-state">No payments yet.</p>
      )}
    </section>
  );

  return (
    <>
      {/* Row 1: 14-day area + status / received-by-type */}
      <div className="content-grid">
        <section className="section">
          <h3>{chartTitle}</h3>
          {hasVolume ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f4" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={64}
                  tickFormatter={axis} />
                <Tooltip formatter={(v) => [dc.formatValue(Number(v)), isWorker ? 'Received' : 'Volume']} />
                <Area type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2} fill="url(#volFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="empty-state">{emptyText}</p>
          )}
        </section>

        {isWorker ? (
          <section className="section">
            <h3>Received by Type</h3>
            {railData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={railData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={55} outerRadius={82} paddingAngle={2}>
                    {railData.map((d) => (
                      <Cell key={d.key} fill={RAIL_COLORS[d.key] ?? '#9ca3af'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [dc.formatValue(Number(v)), String(n)]} />
                  <Legend verticalAlign="bottom" height={24} iconType="circle"
                    formatter={(v) => <span style={{ fontSize: 12, color: '#374151' }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="empty-state">No payments received yet.</p>
            )}
          </section>
        ) : statusPie}
      </div>

      {/* Row 2: 6-month trend + top workers / status */}
      <div className="content-grid">
        <section className="section">
          <h3>{isWorker ? `Monthly Income (${dc.code})` : `Monthly Payout Trend (${dc.code})`}</h3>
          {hasMonthly ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f4" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={64}
                  tickFormatter={axis} />
                <Tooltip formatter={(v) => [dc.formatValue(Number(v)), isWorker ? 'Income' : 'Paid out']} />
                <Bar dataKey="value" fill={chartColor} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="empty-state">No completed payments in the last 6 months.</p>
          )}
        </section>

        {isWorker ? statusPie : (
          <section className="section">
            <h3>Top Workers by Volume</h3>
            {topWorkers.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart layout="vertical" data={topWorkers} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f4" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
                    tickFormatter={axis} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }}
                    axisLine={false} tickLine={false} width={72} />
                  <Tooltip formatter={(v) => [dc.formatValue(Number(v)), 'Total paid']} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20}>
                    {topWorkers.map((_, i) => (
                      <Cell key={i} fill={WORKER_COLORS[i % WORKER_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="empty-state">No completed payouts yet.</p>
            )}
          </section>
        )}
      </div>
    </>
  );
}
