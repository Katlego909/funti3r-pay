import { useEffect, useMemo, useState } from 'react';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';
import { Helmet } from 'react-helmet-async';
import {
  HiOutlineArrowDownOnSquare,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineMagnifyingGlass,
  HiOutlineXMark,
} from 'react-icons/hi2';
import { listPayments, listAllPayments, type Payment } from '../api/payments.js';
import { exportPaymentsCSV, exportPaymentsPDF } from '../utils/export.js';
import { useAuthStore, apiErrorKind, apiErrorMessage, type ApiErrorKind } from '@funti3r/web-core';
import PaymentDetailModal from '../components/PaymentDetailModal.js';
import { EmptyState, ErrorState, PageHeader, ExportButtons, SkeletonTable, StatusBadge, STATUS_TABS } from '@funti3r/ui';
import IncomeStatementButton from '../components/IncomeStatementButton.js';
import { EXPLORER } from '@funti3r/ui';

export default function PaymentHistory() {
  const dc = useDisplayCurrency();
  const user = useAuthStore((s) => s.user);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ message: string; kind: ApiErrorKind } | null>(null);
  // Bumped by "Try again": the load below runs again.
  const [attempt, setAttempt] = useState(0);
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
    setFailure(null);
    listPayments({
      workerId: user.userId,
      limit: PAGE,
      offset,
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    })
      .then(({ payments: p, total: t }) => { setPayments(p); setTotal(t); })
      .catch((err: unknown) => setFailure({ message: apiErrorMessage(err, 'Failed to load payment history'), kind: apiErrorKind(err) }))
      .finally(() => setLoading(false));
  }, [user, offset, statusFilter, attempt]);

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
      return await listAllPayments(params);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="dashboard">
      <Helmet>
        <title>Payment History | Funti3rPay</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <PageHeader
        title="Payment History"
        subtitle="View all payments received"
        actions={payments.length > 0 && user && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <IncomeStatementButton workerId={user.userId} workerEmail={user.email} />
            <ExportButtons
              exporting={exporting}
              onCSV={async () => { const all = await fetchAllForExport(); exportPaymentsCSV(all, statusFilter !== 'all' ? `-${statusFilter}` : ''); }}
              onPDF={async () => { const all = await fetchAllForExport(); exportPaymentsPDF(all, statusFilter !== 'all' ? `-${statusFilter}` : ''); }}
            />
          </div>
        )}
      />

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

      {loading && payments.length === 0 ? (
        <section className="section"><SkeletonTable columns={5} /></section>
      ) : failure ? (
        <section className="section"><ErrorState message={failure.message} kind={failure.kind} onRetry={() => setAttempt((n) => n + 1)} /></section>
      ) : (
      <section className={`section${loading ? ' is-refreshing' : ''}`}>
        {payments.length === 0 ? (
          <EmptyState
            icon={HiOutlineArrowDownOnSquare}
            title={statusFilter !== 'all' ? 'No payments match this filter' : 'No payments yet'}
            message={statusFilter !== 'all' ? 'Try another status.' : 'When an employer pays you, the payment shows up here.'}
          />
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
                      <td data-label="Amount" style={{ fontWeight: 600 }}>{dc.format(p.amount, p.currency)}</td>
                      <td data-label="Status"><StatusBadge status={p.status} /></td>
                      <td data-label="Date">{new Date(p.created_at).toLocaleString()}</td>
                      <td data-label="Transaction">
                        {p.stellar_tx_hash ? (
                          <a
                            href={`${EXPLORER}/tx/${p.stellar_tx_hash}`}
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
