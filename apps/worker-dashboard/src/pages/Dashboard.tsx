import { useEffect, useState } from 'react';
import { HiOutlineBanknotes, HiOutlineClock, HiOutlineCheckCircle, HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import { getSummary, getRecentPayments, getXlmPrice, getFxRates, listPayments, type Payment, type PaymentSummary } from '../api/payments.js';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/authStore.js';
import InsightsCharts from '../components/InsightsCharts.js';
import '../styles/Dashboard.css';

function statusClass(s: string) {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  return 'pending';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.userId) return;

    console.log('[Dashboard] Mounting, loading data...');

    async function fetchWalletBalance() {
      try {
        // Use the gateway api client (adds auth token). The wallet endpoint
        // returns { userId, walletType, address }; balance defaults to 0
        // until on-chain balance lookup is wired up.
        const { data } = await api.get(`/wallets/${user.userId}`);
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
        console.log('[Dashboard] Data loaded:', { pSummary, payments });
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
    listPayments({ workerId: user.userId, limit: 200 })
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
  const byCurrencyLine = summary
    ? Object.entries(summary.byCurrency)
        .map(([c, a]) => `${Number(a).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c}`)
        .join(' · ')
    : '';

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
          {byCurrencyLine && (
            <div className="metric-change neutral" style={{ fontSize: '0.72rem', opacity: 0.8 }}>{byCurrencyLine}</div>
          )}
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
                  <tr key={p.id}>
                    <td>#{p.id.slice(0, 8)}</td>
                    <td>{p.worker_email ?? p.worker_id.slice(0, 8)}</td>
                    <td>{p.amount} {p.currency}</td>
                    <td>{p.rail ?? 'stellar'}</td>
                    <td>
                      <span className={`status ${statusClass(p.status)}`}>{p.status}</span>
                    </td>
                    <td>{new Date(p.created_at).toLocaleDateString()}</td>
                    <td>
                      {p.stellar_tx_hash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View on Stellar Explorer"
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
    </div>
  );
}
