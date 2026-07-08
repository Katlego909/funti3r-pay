import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  HiOutlineUsers,
  HiOutlineBanknotes,
  HiOutlineClock,
  HiOutlineCheckCircle,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineArrowRight,
  HiOutlineArrowDownTray,
} from 'react-icons/hi2';
import { exportAnalyticsCSV, exportAnalyticsPDF } from '../utils/export.js';
import {
  getSummary,
  getRecentPayments,
  getXlmPrice,
  getFxRates,
  listPayments,
  type Payment,
  type PaymentSummary,
} from '../api/payments.js';
import { getUserSummary } from '../api/workers.js';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/authStore.js';
import InsightsCharts from '../components/InsightsCharts.js';
import PaymentDetailModal from '../components/PaymentDetailModal.js';
import '../styles/Dashboard.css';

function statusClass(s: string) {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  return 'pending';
}

const CURRENCY_COLORS: Record<string, string> = {
  XLM: '#3b82f6',
  USDC: '#16a34a',
  NGN: '#f59e0b',
  KES: '#8b5cf6',
  GHS: '#ec4899',
  ZAR: '#06b6d4',
  UGX: '#ef4444',
};

function CurrencyBadges({ byCurrency }: { byCurrency: Record<string, number> }) {
  const entries = Object.entries(byCurrency).filter(([, a]) => Number(a) > 0);
  if (entries.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
      {entries.map(([code, amt]) => {
        const color = CURRENCY_COLORS[code] ?? '#6b7280';
        return (
          <span
            key={code}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '999px',
              background: `${color}14`,
              border: `1px solid ${color}40`,
              color,
              fontSize: '0.72rem',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
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
  const isEnterprise = user?.role !== 'worker';

  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
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

    async function fetchWalletBalance() {
      try {
        const { data } = await api.get(isEnterprise ? '/wallets/company' : `/wallets/${user!.userId}`);
        const all: any[] = data.balances ?? [];
        const xlmBalance = all.find((b) => b.asset_type === 'native')?.balance;
        const others = all
          .filter((b) => b.asset_code && Number(b.balance) > 0)
          .map((b) => ({ code: b.asset_code as string, balance: b.balance as string }));
        setWalletBalance(xlmBalance ?? '0');
        setOtherBalances(others);
      } catch {
        setWalletBalance('0');
      }
    }

    const summaryFetch = isEnterprise
      ? Promise.all([getSummary(), getUserSummary(), getRecentPayments(8)]).then(
          ([pSummary, uSummary, payments]) => {
            setSummary(pSummary);
            setUserCount(uSummary.total);
            setRecent(payments);
          }
        )
      : Promise.all([getSummary(), getRecentPayments(8)]).then(([pSummary, payments]) => {
          setSummary(pSummary);
          setRecent(payments);
        });

    summaryFetch
      .catch((err) => setError(err.message ?? 'Failed to load dashboard'))
      .finally(() => setLoading(false));

    fetchWalletBalance();
    getXlmPrice().then(setXlmUsd);
    getFxRates().then(setFxRates);

    if (isEnterprise) {
      api.get<{ company_name?: string }>(`/users/${user.userId}`)
        .then((r) => setCompanyName(r.data.company_name ?? null))
        .catch(() => setCompanyName(null));
    }

    const chartQuery = isEnterprise
      ? listPayments({ limit: 200 })
      : listPayments({ workerId: user.userId, limit: 200 });

    chartQuery.then(({ payments }) => setChartPayments(payments)).catch(() => setChartPayments([]));
  }, [user, isEnterprise]);

  if (loading) return <div className="loading">Loading dashboard…</div>;
  if (error) return <div className="error-banner">{error}</div>;

  const pending = summary?.byStatus['pending'] ?? 0;
  const processing = summary?.byStatus['processing'] ?? 0;

  const fmtXlm = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtUsd = (xlm: number) =>
    xlmUsd > 0
      ? `≈ $${(xlm * xlmUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '';
  const balanceXlm = walletBalance ? parseFloat(walletBalance) : 0;
  const unit = (lbl: string) => (
    <span style={{ fontSize: '0.5em', fontWeight: 600, marginLeft: '0.2em', opacity: 0.85 }}>
      {lbl}
    </span>
  );
  const fmtMoney = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="dashboard">
      <Helmet>
        <title>Dashboard | Funti3rPay</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      {/* Header */}
      <div className="dashboard-header">
        <div className="dashboard-greeting">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h2 className="greeting-name">Hello, {user?.email.split('@')[0]}</h2>
            {isEnterprise && companyName && (
              <span style={{
                fontSize: '12px', fontWeight: 700, color: 'var(--primary)',
                background: 'rgba(66, 10, 99, 0.08)', padding: '3px 10px',
                borderRadius: '999px', whiteSpace: 'nowrap',
              }}>
                {companyName}
              </span>
            )}
          </div>
          <p className="greeting-sub">
            {isEnterprise ? 'Overview of your payment operations' : 'Your incoming payments'}
          </p>
        </div>
        {isEnterprise ? (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {summary && recent.length > 0 && (
              <div className="export-btn-group">
                <button className="btn-export" onClick={() => exportAnalyticsCSV(summary, recent)}>
                  <HiOutlineArrowDownTray size={14} /> CSV
                </button>
                <button className="btn-export" onClick={() => exportAnalyticsPDF(summary, recent)}>
                  <HiOutlineArrowDownTray size={14} /> PDF
                </button>
              </div>
            )}
            <Link to="/payments" className="btn-new-payout">
              New Payout <HiOutlineArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <Link to="/wallet" className="btn-new-payout">
            My Wallet <HiOutlineArrowRight size={16} />
          </Link>
        )}
      </div>

      {/* Metric cards */}
      <div className="metrics-grid">
        {/* Wallet Balance */}
        <div className="metric-card" data-accent="orange">
          <div className="metric-header">
            <span className="metric-icon">
              <HiOutlineBanknotes size={18} />
            </span>
            <h3>Wallet Balance</h3>
          </div>
          <div className="metric-value">
            {walletBalance ? (
              <>
                {fmtXlm(balanceXlm)}
                {unit('XLM')}
              </>
            ) : (
              '—'
            )}
          </div>
          {!isEnterprise &&
            otherBalances.map((b) => (
              <div
                key={b.code}
                className="metric-value"
                style={{ color: 'var(--success)', fontSize: '1rem' }}
              >
                {fmtXlm(parseFloat(b.balance))}
                {unit(b.code)}
              </div>
            ))}
          {walletBalance && xlmUsd > 0 && <div className="metric-change">{fmtUsd(balanceXlm)}</div>}
        </div>

        {/* Total Payments */}
        <div className="metric-card" data-accent="green">
          <div className="metric-header">
            <span className="metric-icon">
              <HiOutlineBanknotes size={18} />
            </span>
            <h3>{isEnterprise ? 'Total Payments' : 'Total Received'}</h3>
          </div>
          <div className="metric-value">
            {summary ? `$${fmtMoney(summary.completedVolumeUsd)}` : '—'}
          </div>
          <div className="metric-change">{summary?.totalCount ?? 0} transactions</div>
          {summary && <CurrencyBadges byCurrency={summary.byCurrency} />}
        </div>

        {/* Enterprise: Total Workers / Worker: Pending */}
        {isEnterprise ? (
          <div className="metric-card" data-accent="purple">
            <div className="metric-header">
              <span className="metric-icon">
                <HiOutlineUsers size={18} />
              </span>
              <h3>Total Workers</h3>
            </div>
            <div className="metric-value">{userCount ?? '—'}</div>
            {userCount !== null && <div className="metric-change">registered workers</div>}
          </div>
        ) : (
          <div className="metric-card" data-accent="warning">
            <div className="metric-header">
              <span className="metric-icon">
                <HiOutlineClock size={18} />
              </span>
              <h3>Pending</h3>
            </div>
            <div className="metric-value">{pending + processing}</div>
            {pending + processing > 0 && <div className="metric-change">awaiting settlement</div>}
          </div>
        )}

        {/* Enterprise: Success Rate / Worker: Completed payments */}
        {isEnterprise ? (
          <div className="metric-card" data-accent="warning">
            <div className="metric-header">
              <span className="metric-icon">
                <HiOutlineCheckCircle size={18} />
              </span>
              <h3>Success Rate</h3>
            </div>
            <div className="metric-value">
              {summary ? (
                <>
                  {summary.successRate}
                  {unit('%')}
                </>
              ) : (
                '—'
              )}
            </div>
          </div>
        ) : (
          <div className="metric-card" data-accent="purple">
            <div className="metric-header">
              <span className="metric-icon">
                <HiOutlineCheckCircle size={18} />
              </span>
              <h3>Completed</h3>
            </div>
            <div className="metric-value">{summary?.byStatus['completed'] ?? '—'}</div>
            <div className="metric-change">payments received</div>
          </div>
        )}
      </div>

      {/* Charts */}
      <InsightsCharts
        payments={chartPayments}
        xlmUsd={xlmUsd}
        fx={fxRates}
        byStatus={summary?.byStatus ?? {}}
        byCurrency={summary?.byCurrency ?? {}}
        isWorker={!isEnterprise}
      />

      {/* Recent transactions + breakdown */}
      <div className="content-grid">
        <section className="section">
          <h3>Recent Transactions</h3>
          {recent.length === 0 ? (
            <p className="empty-state">No transactions yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{isEnterprise ? 'Worker' : 'From'}</th>
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
                      <td data-label="ID">#{p.id.slice(0, 8)}</td>
                      <td data-label={isEnterprise ? 'Worker' : 'From'}>{p.worker_email ?? p.worker_id.slice(0, 8)}</td>
                      <td data-label="Amount">
                        {p.amount} {p.currency}
                      </td>
                      <td data-label="Rail">{p.rail ?? 'stellar'}</td>
                      <td data-label="Status">
                        <span className={`status ${statusClass(p.status)}`}>{p.status}</span>
                      </td>
                      <td data-label="Date">{new Date(p.created_at).toLocaleDateString()}</td>
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
            </div>
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
                    <div className="status-name" style={{ textTransform: 'capitalize' }}>
                      {status}
                    </div>
                    <div className="status-detail">
                      {count} transaction{count !== 1 ? 's' : ''}
                    </div>
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
