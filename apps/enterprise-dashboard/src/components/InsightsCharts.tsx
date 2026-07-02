import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts';
import type { Payment } from '../api/payments.js';

const WORKER_COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const STATUS_COLORS: Record<string, string> = {
  completed: '#16a34a', failed: '#dc2626', pending: '#d97706',
  initiated: '#7c3aed', submitted: '#7c3aed', cancelled: '#9ca3af',
};

function usdValue(p: Payment, xlmUsd: number, fx: Record<string, number>): number {
  const amt = Number(p.amount);
  const c = p.currency;
  if (c === 'XLM') return amt * xlmUsd;
  if (c === 'USDC' || c === 'USD') return amt;
  const unitsPerUsd = Number(fx[c]);
  return unitsPerUsd > 0 ? amt / unitsPerUsd : 0;
}

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dailyUsd(payments: Payment[], xlmUsd: number, fx: Record<string, number>, days = 14) {
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
    if (key in buckets) buckets[key] += usdValue(p, xlmUsd, fx);
  }
  return order.map((key) => ({
    date: new Date(key + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    usd: Math.round(buckets[key] * 100) / 100,
  }));
}

function monthlyUsd(payments: Payment[], xlmUsd: number, fx: Record<string, number>, months = 6) {
  const today = new Date();
  const result: { month: string; usd: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    result.push({
      month: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      usd: 0,
    });
  }
  for (const p of payments) {
    if (p.status !== 'completed') continue;
    const d = new Date(p.created_at);
    const idx = (d.getFullYear() - today.getFullYear()) * 12 + d.getMonth() - today.getMonth() + (months - 1);
    if (idx >= 0 && idx < months) result[idx].usd += usdValue(p, xlmUsd, fx);
  }
  return result.map((r) => ({ ...r, usd: Math.round(r.usd * 100) / 100 }));
}

function topWorkersByVolume(payments: Payment[], xlmUsd: number, fx: Record<string, number>, limit = 7) {
  const totals: Record<string, { name: string; usd: number }> = {};
  for (const p of payments) {
    if (p.status !== 'completed') continue;
    const key = p.worker_id;
    const name = p.worker_email?.split('@')[0] ?? p.worker_id.slice(0, 8);
    if (!totals[key]) totals[key] = { name, usd: 0 };
    totals[key].usd += usdValue(p, xlmUsd, fx);
  }
  return Object.values(totals)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, limit)
    .map((w) => ({ ...w, usd: Math.round(w.usd * 100) / 100 }));
}

const fmtUsd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const CURRENCY_COLORS: Record<string, string> = {
  XLM: '#7c3aed', USDC: '#16a34a', NGN: '#f59e0b',
  KES: '#8b5cf6', GHS: '#ec4899', ZAR: '#06b6d4', UGX: '#ef4444',
};

export default function InsightsCharts({
  payments, xlmUsd, byStatus = {}, byCurrency = {}, fx = {}, isWorker = false,
}: {
  payments: Payment[];
  xlmUsd: number;
  byStatus?: Record<string, number>;
  byCurrency?: Record<string, number>;
  fx?: Record<string, number>;
  isWorker?: boolean;
}) {
  const series = dailyUsd(payments, xlmUsd, fx);
  const monthly = monthlyUsd(payments, xlmUsd, fx);
  const hasVolume = series.some((d) => d.usd > 0);
  const hasMonthly = monthly.some((d) => d.usd > 0);

  const statusData = Object.entries(byStatus)
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0);

  const currencyData = Object.entries(byCurrency)
    .map(([name, value]) => ({ name, value: Number(value) }))
    .filter((d) => d.value > 0);

  const topWorkers = isWorker ? [] : topWorkersByVolume(payments, xlmUsd, fx);

  const chartColor = isWorker ? '#16a34a' : '#7c3aed';
  const chartTitle = isWorker ? 'Received (USD · 14 days)' : 'Payout Volume (USD · 14 days)';
  const emptyText = isWorker
    ? 'No payments received in the last 14 days.'
    : 'No completed payouts in the last 14 days.';

  return (
    <>
      {/* Row 1: 14-day area + pie */}
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
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={48}
                  tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v) => [fmtUsd(Number(v)), isWorker ? 'Received' : 'Volume']} />
                <Area type="monotone" dataKey="usd" stroke={chartColor} strokeWidth={2} fill="url(#volFill)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="empty-state">{emptyText}</p>
          )}
        </section>

        {isWorker ? (
          <section className="section">
            <h3>Received by Currency</h3>
            {currencyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={currencyData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={55} outerRadius={82} paddingAngle={2}>
                    {currencyData.map((d) => (
                      <Cell key={d.name} fill={CURRENCY_COLORS[d.name] ?? '#9ca3af'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }), String(n)]} />
                  <Legend verticalAlign="bottom" height={24} iconType="circle"
                    formatter={(v) => <span style={{ fontSize: 12, color: '#374151' }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="empty-state">No payments received yet.</p>
            )}
          </section>
        ) : (
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
        )}
      </div>

      {/* Row 2: 6-month trend + top workers / currency breakdown */}
      <div className="content-grid">
        <section className="section">
          <h3>{isWorker ? 'Monthly Income (USD)' : 'Monthly Payout Trend (USD)'}</h3>
          {hasMonthly ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f4" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={48}
                  tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v) => [fmtUsd(Number(v)), isWorker ? 'Income' : 'Paid out']} />
                <Bar dataKey="usd" fill={chartColor} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="empty-state">No completed payments in the last 6 months.</p>
          )}
        </section>

        {isWorker ? (
          <section className="section">
            <h3>Currency Breakdown</h3>
            {currencyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart layout="vertical" data={currencyData} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f4" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => v.toLocaleString()} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#374151', fontWeight: 600 }}
                    axisLine={false} tickLine={false} width={44} />
                  <Tooltip formatter={(v, n) => [Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }), String(n)]} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={24}>
                    {currencyData.map((d) => (
                      <Cell key={d.name} fill={CURRENCY_COLORS[d.name] ?? '#9ca3af'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="empty-state">No currency data yet.</p>
            )}
          </section>
        ) : (
          <section className="section">
            <h3>Top Workers by Volume</h3>
            {topWorkers.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart layout="vertical" data={topWorkers} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f4" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }}
                    axisLine={false} tickLine={false} width={72} />
                  <Tooltip formatter={(v) => [fmtUsd(Number(v)), 'Total paid']} />
                  <Bar dataKey="usd" radius={[0, 4, 4, 0]} maxBarSize={20}>
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
