import { useEffect, useMemo, useState } from 'react';
import {
  HiOutlineArrowDownOnSquare,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineArrowDownTray,
  HiOutlineMagnifyingGlass,
  HiOutlineXMark,
} from 'react-icons/hi2';
import { listPayments, type Payment } from '../api/payments.js';
import { exportPaymentsCSV, exportPaymentsPDF } from '../utils/export.js';
import { useAuthStore } from '../store/authStore.js';
import PaymentDetailModal from '../components/PaymentDetailModal.js';
import '../styles/Dashboard.css';

function statusClass(s: string) {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  return 'pending';
}

const STATUS_TABS = ['all', 'completed', 'failed', 'pending_claim', 'initiated'] as const;

export default function PaymentHistory() {
  const user = useAuthStore((s) => s.user);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const PAGE = 20;

  useEffect(() => {
    setOffset(0);
  }, [statusFilter]);

  useEffect(() => {
    if (!user?.userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    listPayments({
      workerId: user.userId,
      limit: PAGE,
      offset,
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    })
      .then(({ payments: p, total: t }) => { setPayments(p); setTotal(t); setError(''); })
      .catch((err: any) => setError(err?.response?.data?.error ?? 'Failed to load payment history'))
      .finally(() => setLoading(false));
  }, [user, offset, statusFilter]);

  const visiblePayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.currency.toLowerCase().includes(q) ||
        (p.stellar_tx_hash ?? '').toLowerCase().includes(q),
    );
  }, [payments, search]);

  async function fetchAllForExport(): Promise<Payment[]> {
    if (!user) return [];
    setExporting(true);
    try {
      const params = { workerId: user.userId, ...(statusFilter !== 'all' ? { status: statusFilter } : {}) };
      const { total: t } = await listPayments({ ...params, limit: 1, offset: 0 });
      const { payments: all } = await listPayments({ ...params, limit: t, offset: 0 });
      return all;
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Payment History</h2>
          <p className="subtitle">View all payments received</p>
        </div>
        {payments.length > 0 && (
          <div className="export-btn-group">
            <button className="btn-export" disabled={exporting} onClick={async () => { const all = await fetchAllForExport(); exportPaymentsCSV(all, statusFilter !== 'all' ? `-${statusFilter}` : ''); }}>
              <HiOutlineArrowDownTray size={14} /> {exporting ? 'Exporting…' : 'CSV'}
            </button>
            <button className="btn-export" disabled={exporting} onClick={async () => { const all = await fetchAllForExport(); exportPaymentsPDF(all, statusFilter !== 'all' ? `-${statusFilter}` : ''); }}>
              <HiOutlineArrowDownTray size={14} /> {exporting ? 'Exporting…' : 'PDF'}
            </button>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="payments-filter-bar">
        <div className="payments-status-tabs">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              className={`status-tab ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : s === 'pending_claim' ? 'Pending Claim' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="payments-search-wrap">
          <HiOutlineMagnifyingGlass size={16} className="search-icon" />
          <input
            className="payments-search"
            placeholder="Search by currency, ID or tx hash…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>
              <HiOutlineXMark size={14} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading payment history…</div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : (
      <section className="section">
        {payments.length === 0 ? (
          <div className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <HiOutlineArrowDownOnSquare size={48} style={{ color: '#d1d5db', margin: '0 auto 1rem' }} />
            <p>{statusFilter !== 'all' ? 'No payments match this filter.' : 'No payments yet.'}</p>
          </div>
        ) : (
          <>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePayments.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem' }}>No payments found.</td></tr>
                  ) : visiblePayments.map((p) => (
                    <tr key={p.id} onClick={() => setDetailId(p.id)} style={{ cursor: 'pointer' }}>
                      <td data-label="Amount" style={{ fontWeight: 600 }}>{p.amount} {p.currency}</td>
                      <td data-label="Status"><span className={`status ${statusClass(p.status)}`}>{p.status}</span></td>
                      <td data-label="Date">{new Date(p.created_at).toLocaleString()}</td>
                      <td data-label="Transaction">
                        {p.stellar_tx_hash ? (
                          <a
                            href={`https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontFamily: 'monospace', fontSize: '0.8rem' }}
                          >
                            {p.stellar_tx_hash.slice(0, 8)}… <HiOutlineArrowTopRightOnSquare size={13} />
                          </a>
                        ) : (
                          <span style={{ color: '#9ca3af' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Prev</button>
              <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
              <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next →</button>
            </div>
          </>
        )}
      </section>
      )}

      <PaymentDetailModal paymentId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
