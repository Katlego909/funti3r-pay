import { useEffect, useState } from 'react';
import { HiOutlineBanknotes, HiOutlineClock, HiOutlineCheckCircle, HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import { getSummary, getRecentPayments, getXlmPrice, getFxRates, listPayments, type Payment, type PaymentSummary } from '../api/payments.js';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/authStore.js';
import InsightsCharts from '../components/InsightsCharts.js';
import PaymentDetailModal from '../components/PaymentDetailModal.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { statusClass } from '../lib/status.js';
import '../styles/Dashboard.css';

const CURRENCY_COLORS: Record<string, string> = {
  XLM: '#3b82f6', USDC: '#16a34a', NGN: '#f59e0b', KES: '#8b5cf6',
  GHS: '#ec4899', ZAR: '#06b6d4', UGX: '#ef4444',
};

function CurrencyBadges({ byCurrency }: { byCurrency: Record<string, number> }) {
  const entries = Object.entries(byCurrency).filter(([, a]) => Number(a) > 0);
  if (entries.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
      {entries.map(([code, amt]) => {
        const color = CURRENCY_COLORS[code] ?? '#6b7280';
        return (
          <span key={code} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '4px 10px', borderRadius: '999px',
            background: `${color}14`, border: `1px solid ${color}40`,
            color, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
            {Number(amt).toLocaleString(undefined, { maximumFractionDigits: 2 })} {code}
          </span>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [otherBalances, setOtherBalances] = useState<Array<{ code: string; balance: string }>>([]);
  const [xlmUsd, setXlmUsd] = useState(0);
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<Payment[]>([]);
  const [chartPayments, setChartPayments] = useState<Payment[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.userId) return;
    const userId = user.userId;

    async function fetchWalletBalance() {
      try {
        // Use the gateway api client (adds auth token). The wallet endpoint
        // returns { userId, walletType, address }; balance defaults to 0
        // until on-chain balance lookup is wired up.
        const { data } = await api.get(`/wallets/${userId}`);
        const all: any[] = data.balances ?? [];
        const xlmBalance = all.find((b) => b.asset_type === 'native')?.balance;
        // Any issued asset (USDC, NGN, KES, …) with a non-zero balance.
        const others = all
          .filter((b) => b.asset_code && Number(b.balance) > 0)
          .map((b) => ({ code: b.asset_code as string, balance: b.balance as string }));
        setWalletBalance(xlmBalance ?? '0');
        setOtherBalances(others);
      } catch (err) {
        console.error('[Dashboard] Error loading wallet:', err);
        setWalletBalance('0');
      }
    }

    Promise.all([getSummary(), getRecentPayments(8)])
      .then(([pSummary, payments]) => {
        setSummary(pSummary);
        setRecent(payments);
      })
      .catch((err) => {
        console.error('[Dashboard] Error loading data:', err);
        setError(err.message ?? 'Failed to load dashboard');
      })
      .finally(() => setLoading(false));

    fetchWalletBalance();
    getXlmPrice().then(setXlmUsd);
    getFxRates().then(setFxRates);
    // More rows for the charts than the 8-row recent table.
    listPayments({ workerId: userId, limit: 200 })
      .then(({ payments }) => setChartPayments(payments))
      .catch(() => setChartPayments([]));
  }, [user]);

  if (loading) return <div className="loading">Loading dashboard…</div>;
  if (error) return <div className="error-banner">{error}</div>;

  const pending = summary?.byStatus['pending'] ?? 0;
  const processing = summary?.byStatus['processing'] ?? 0;

  const fmtXlm = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtUsd = (xlm: number) => xlmUsd > 0
    ? `≈ $${(xlm * xlmUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '';
  const balanceXlm = walletBalance ? parseFloat(walletBalance) : 0;
  // Currency unit / percent rendered smaller than the number so large amounts
  // don't get clipped (em scales with the metric font size).
  const unit = (label: string) => (
    <span style={{ fontSize: '0.5em', fontWeight: 600, marginLeft: '0.2em', opacity: 0.85 }}>{label}</span>
  );
  const fmtMoney = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <p className="subtitle">Overview of your payment operations</p>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header">
            <HiOutlineBanknotes size={20} className="metric-icon" />
            <h3>Wallet Balance</h3>
          </div>
          <div className="metric-value" style={{ color: '#3b82f6', whiteSpace: 'nowrap' }}>
            {walletBalance ? <>{fmtXlm(balanceXlm)}{unit('XLM')}</> : '—'}
          </div>
          {otherBalances.map((b) => (
            <div key={b.code} className="metric-value" style={{ color: '#16a34a', fontSize: '1rem', whiteSpace: 'nowrap' }}>
              {fmtXlm(parseFloat(b.balance))}{unit(b.code)}
            </div>
          ))}
          {walletBalance && xlmUsd > 0 && (
            <div className="metric-change neutral">{fmtUsd(balanceXlm)}</div>
          )}
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <HiOutlineBanknotes size={20} className="metric-icon" />
            <h3>Total Payments Received</h3>
          </div>
          <div className="metric-value" style={{ whiteSpace: 'nowrap' }}>
            {summary ? `$${fmtMoney(summary.completedVolumeUsd)}` : '—'}
          </div>
          <div className="metric-change neutral">{summary?.totalCount ?? 0} transactions</div>
          {summary && <CurrencyBadges byCurrency={summary.byCurrency} />}
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <HiOutlineClock size={20} className="metric-icon" />
            <h3>Pending / Processing</h3>
          </div>
          <div className="metric-value">{pending + processing}</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <HiOutlineCheckCircle size={20} className="metric-icon" />
            <h3>Success Rate</h3>
          </div>
          <div className="metric-value">
            {summary ? <>{summary.successRate}{unit('%')}</> : '—'}
          </div>
        </div>
      </div>

      <InsightsCharts payments={chartPayments} xlmUsd={xlmUsd} fx={fxRates} />

      <div className="content-grid">
        <section className="section">
          <h3>Recent Transactions</h3>
          {recent.length === 0 ? (
            <p className="empty-state">No transactions yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Worker</th>
                  <th>Amount</th>
                  <th>Rail</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => (
                  <tr key={p.id} onClick={() => setDetailId(p.id)} style={{ cursor: 'pointer' }}>
                    <td>#{p.id.slice(0, 8)}</td>
                    <td>{p.worker_email ?? p.worker_id.slice(0, 8)}</td>
                    <td>{p.amount} {p.currency}</td>
                    <td>{p.rail ?? 'stellar'}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td>{new Date(p.created_at).toLocaleDateString()}</td>
                    <td>
                      {p.stellar_tx_hash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View on Stellar Explorer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <HiOutlineArrowTopRightOnSquare size={14} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="section">
          <h3>Payment Breakdown</h3>
          {summary && (
            <div className="status-list">
              {Object.entries(summary.byStatus).map(([status, count]) => (
                <div className="status-item" key={status}>
                  <div className={`status-dot ${statusClass(status)}`} />
                  <div>
                    <div className="status-name" style={{ textTransform: 'capitalize' }}>{status}</div>
                    <div className="status-detail">{count} transaction{count !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="status-badge">{count}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <PaymentDetailModal paymentId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
