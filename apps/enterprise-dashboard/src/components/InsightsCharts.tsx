import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import type { Payment } from '../api/payments.js';

const STATUS_COLORS: Record<string, string> = {
  completed: '#16a34a', failed: '#dc2626', pending: '#d97706',
  initiated: '#7c3aed', submitted: '#7c3aed', cancelled: '#9ca3af',
};

/**
 * USD value of a payment.
 *  XLM → amount × XLM price · USDC → amount · local → amount ÷ (units per USD).
 * `fx` maps a currency code to units-per-USD (USDC = 1); XLM uses `xlmUsd`.
 */
function usdValue(p: Payment, xlmUsd: number, fx: Record<string, number>): number {
  const amt = Number(p.amount);
  const c = p.currency;
  if (c === 'XLM') return amt * xlmUsd;
  if (c === 'USDC' || c === 'USD') return amt;
  const unitsPerUsd = Number(fx[c]);
  return unitsPerUsd > 0 ? amt / unitsPerUsd : 0;
}

/** Local (not UTC) date key YYYY-MM-DD so "today" buckets match local dates. */
function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Daily completed volume in USD for the last `days` days (gaps filled with 0). */
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
  const hasVolume = series.some((d) => d.usd > 0);
  const statusData = Object.entries(byStatus)
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0);
  const currencyData = Object.entries(byCurrency)
    .map(([name, value]) => ({ name, value: Number(value) }))
    .filter((d) => d.value > 0);

  const chartColor = isWorker ? '#16a34a' : '#7c3aed';
  const chartTitle = isWorker ? 'Received (USD · 14 days)' : 'Payout Volume (USD · 14 days)';
  const emptyText = isWorker
    ? 'No payments received in the last 14 days.'
    : 'No completed payouts in the last 14 days.';

  return (
    <div className="content-grid">
      <section className="section">
        <h3>{chartTitle}</h3>
        {hasVolume ? (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="volFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={48}
                tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number) => [fmtUsd(v), isWorker ? 'Received' : 'Volume']} />
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
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={currencyData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {currencyData.map((d) => (
                    <Cell key={d.name} fill={CURRENCY_COLORS[d.name] ?? '#9ca3af'} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [v.toLocaleString(undefined, { maximumFractionDigits: 2 }), n]} />
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
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {statusData.map((d) => (
                    <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? '#9ca3af'} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [v, n]} />
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
  );
}
