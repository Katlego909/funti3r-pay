import { useEffect, useState } from 'react';
import { HiOutlineBanknotes, HiOutlineClock, HiOutlineCheckCircle, HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import { getSummary, getRecentPayments, type Payment, type PaymentSummary } from '../api/payments.js';
import { useAuthStore } from '../store/authStore.js';
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
  const [recent, setRecent] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.userId) return;

    console.log('[Dashboard] Mounting, loading data...');

    async function fetchWalletBalance() {
      try {
        const response = await fetch(`/api/wallets/${user.userId}`);
        if (response.ok) {
          const data = await response.json();
          const xlmBalance = data.balances?.find((b: any) => b.asset_type === 'native')?.balance;
          setWalletBalance(xlmBalance || '0');
        }
      } catch (err) {
        console.error('[Dashboard] Error loading wallet:', err);
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
  }, [user]);

  if (loading) return <div className="loading">Loading dashboard…</div>;
  if (error) return <div className="error-banner">{error}</div>;

  const pending = summary?.byStatus['pending'] ?? 0;
  const processing = summary?.byStatus['processing'] ?? 0;

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
          <div className="metric-value" style={{ color: '#3b82f6' }}>
            {walletBalance ? `${parseFloat(walletBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 })} XLM` : '—'}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <HiOutlineBanknotes size={20} className="metric-icon" />
            <h3>Total Payments Received</h3>
          </div>
          <div className="metric-value">
            {summary ? `$${summary.completedVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
          </div>
          <div className="metric-change neutral">{summary?.totalCount ?? 0} transactions</div>
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
            {summary ? `${summary.successRate}%` : '—'}
          </div>
        </div>
      </div>

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
