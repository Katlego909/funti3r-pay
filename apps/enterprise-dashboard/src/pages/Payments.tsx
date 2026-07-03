import { useEffect, useState, FormEvent, useMemo } from 'react';
import { HiOutlineArrowTopRightOnSquare, HiOutlineMagnifyingGlass, HiOutlineXMark, HiOutlineArrowDownTray } from 'react-icons/hi2';
import { toast } from 'sonner';
import { exportPaymentsCSV, exportPaymentsPDF } from '../utils/export.js';
import { listPayments, initiatePayment, initiateBatchPayment, getFxRates, type Payment, type BatchResult } from '../api/payments.js';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/authStore.js';
import PaymentDetailModal from '../components/PaymentDetailModal.js';

interface WorkerOption { id: string; email: string; preferred_currency?: string; stellar_public_key?: string }
interface BatchRow { workerId: string; amount: string }

const CURRENCY_META: Record<string, { name: string; symbol: string }> = {
  USDC: { name: 'USD Coin', symbol: '$' },
  NGN: { name: 'Nigerian Naira', symbol: '₦' },
  KES: { name: 'Kenyan Shilling', symbol: 'KSh' },
  GHS: { name: 'Ghanaian Cedi', symbol: 'GH₵' },
  ZAR: { name: 'South African Rand', symbol: 'R' },
  UGX: { name: 'Ugandan Shilling', symbol: 'USh' },
};

function statusClass(s: string) {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  return 'pending';
}

export default function Payments() {
  const user = useAuthStore((s) => s.user);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // New payment form state
  const [formOpen, setFormOpen] = useState(false);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [workerId, setWorkerId] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  // Batch payment form state
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchCurrency, setBatchCurrency] = useState<'XLM' | 'USDC'>('XLM');
  const [batchRows, setBatchRows] = useState<BatchRow[]>([{ workerId: '', amount: '' }]);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);

  // Payment detail modal
  const [detailId, setDetailId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  async function fetchAllForExport(): Promise<Payment[]> {
    if (!user) return [];
    setExporting(true);
    try {
      const { total } = await listPayments({ enterpriseId: user.userId, limit: 1, offset: 0, ...(statusFilter !== 'all' ? { status: statusFilter } : {}) });
      const { payments: all } = await listPayments({ enterpriseId: user.userId, limit: total, offset: 0, ...(statusFilter !== 'all' ? { status: statusFilter } : {}) });
      return all;
    } finally {
      setExporting(false);
    }
  }

  const STATUS_TABS = ['all', 'completed', 'failed', 'pending_claim', 'initiated'] as const;

  const PAGE = 15;

  function loadPayments() {
    if (!user) return;
    setLoading(true);
    listPayments({
      enterpriseId: user.userId,
      limit: PAGE,
      offset,
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    })
      .then(({ payments: p, total: t }) => { setPayments(p); setTotal(t); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setOffset(0);
  }, [statusFilter]);

  useEffect(() => {
    loadPayments();
  }, [user, offset, statusFilter]);

  const visiblePayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        (p.worker_email ?? '').toLowerCase().includes(q) ||
        p.worker_id.toLowerCase().includes(q),
    );
  }, [payments, search]);

  // Load the worker list + live FX rates once.
  useEffect(() => {
    api.get<{ users?: WorkerOption[] }>('/users?role=worker&limit=100')
      .then((res) => setWorkers(res.data.users ?? []))
      .catch(() => setWorkers([]));
    getFxRates().then(setFxRates);
  }, []);

  const selectedWorker = workers.find((w) => w.id === workerId);
  const payCurrency = (selectedWorker?.preferred_currency || 'USDC').toUpperCase();
  const fxRate = fxRates[payCurrency] ?? (payCurrency === 'USDC' ? 1 : undefined);
  const localPreview = amount && fxRate
    ? `${(Number(amount) * fxRate).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${payCurrency}`
    : '';

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await initiatePayment({
        enterpriseId: user!.userId,
        workerId: workerId.trim(),
        amountUsd: Number(amount),
        memo: memo.trim() || undefined,
      });

      const got = result.amount != null
        ? `${Number(result.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${result.currency}`
        : result.currency;
      toast.success(`Sent $${Number(amount).toFixed(2)} — worker receives ${got}`);
      setFormOpen(false);
      setWorkerId('');
      setAmount('');
      setMemo('');
      loadPayments();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? err?.message ?? 'Payment failed');
    } finally {
      setSubmitting(false);
    }
  }

  function updateBatchRow(i: number, patch: Partial<BatchRow>) {
    setBatchRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function handleSendBatch(e: FormEvent) {
    e.preventDefault();
    setBatchResult(null);
    const items = batchRows
      .filter((r) => r.workerId && r.amount && Number(r.amount) > 0)
      .map((r) => ({ workerId: r.workerId, amount: Number(r.amount) }));
    if (items.length === 0) {
      toast.error('Add at least one worker with a positive amount.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await initiateBatchPayment({
        enterpriseId: user!.userId,
        currency: batchCurrency,
        items,
      });
      setBatchResult(result);
      loadPayments();
      if (result.failedCount === 0) {
        toast.success(`Batch complete — ${result.completedCount} payment(s) sent`);
      } else {
        toast.warning(`Batch partial — ${result.completedCount} sent, ${result.failedCount} failed`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? err?.message ?? 'Batch failed');
    } finally {
      setSubmitting(false);
    }
  }

  const workerEmail = (id: string) => workers.find((w) => w.id === id)?.email ?? id.slice(0, 8);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Payments</h2>
          <p className="subtitle">Send XLM or USDC payouts to your workers on Stellar</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div className="export-btn-group">
            <button className="btn-export" disabled={exporting} onClick={async () => { const all = await fetchAllForExport(); exportPaymentsCSV(all, statusFilter !== 'all' ? `-${statusFilter}` : ''); }}>
              <HiOutlineArrowDownTray size={14} /> {exporting ? 'Exporting…' : 'CSV'}
            </button>
            <button className="btn-export" disabled={exporting} onClick={async () => { const all = await fetchAllForExport(); exportPaymentsPDF(all, statusFilter !== 'all' ? `-${statusFilter}` : ''); }}>
              <HiOutlineArrowDownTray size={14} /> {exporting ? 'Exporting…' : 'PDF'}
            </button>
          </div>
          <button className="btn-secondary" onClick={() => { setBatchOpen(true); setBatchResult(null); setBatchRows([{ workerId: '', amount: '' }]); }}>
            Batch Payout
          </button>
          <button className="btn-cta" onClick={() => setFormOpen(true)}>
            New Payment
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="modal-overlay" onClick={() => setFormOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New Payment</h3>
            <form onSubmit={handleSend} className="payment-form">
              <label>Worker
                <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} required>
                  <option value="">Select a worker…</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>{w.email} — {w.id.slice(0, 8)}…</option>
                  ))}
                </select>
              </label>
              {workerId && (
                <p style={{ margin: '-8px 0 4px', fontSize: '0.78rem', color: '#6b7280' }}>
                  Paid in <strong>{CURRENCY_META[payCurrency]?.name ?? payCurrency} ({payCurrency})</strong>
                  <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', display: 'block' }}>Worker ID: {workerId}</span>
                  {selectedWorker?.stellar_public_key && (
                    <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', display: 'block' }}>
                      Stellar: {selectedWorker.stellar_public_key}
                    </span>
                  )}
                </p>
              )}
              <label>Amount (USD)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  placeholder="e.g. 50.00"
                />
              </label>
              {workerId && localPreview && (
                <p style={{ margin: '-8px 0 4px', fontSize: '0.85rem', color: '#065f46', fontWeight: 600 }}>
                  Worker receives ≈ {localPreview}
                  {payCurrency !== 'USDC' && <span style={{ color: '#6b7280', fontWeight: 400 }}> · converted from USD via the Stellar DEX</span>}
                </p>
              )}
              <label>Memo (optional)
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="e.g. June salary"
                  maxLength={28}
                />
              </label>

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {batchOpen && (
        <div className="modal-overlay" onClick={() => setBatchOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <h3>Batch Payout</h3>
            {!batchResult ? (
              <form onSubmit={handleSendBatch} className="payment-form">
                <label>Currency
                  <select value={batchCurrency} onChange={(e) => setBatchCurrency(e.target.value as 'XLM' | 'USDC')}>
                    <option value="XLM">XLM</option>
                    <option value="USDC">USDC</option>
                  </select>
                </label>

                {/* Column headers (shown once) */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.78rem', fontWeight: 600, color: '#6b7280' }}>
                  <span style={{ flex: 2, minWidth: 0 }}>Worker</span>
                  <span style={{ width: '120px' }}>Amount</span>
                  <span style={{ width: '32px' }} />
                </div>

                {batchRows.map((row, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      style={{ flex: 2, minWidth: 0, boxSizing: 'border-box' }}
                      value={row.workerId}
                      onChange={(e) => updateBatchRow(i, { workerId: e.target.value })}
                    >
                      <option value="">Select a worker…</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>{w.email} — {w.id.slice(0, 8)}…</option>
                      ))}
                    </select>
                    <input
                      type="number" min="0.0000001" step="0.0000001" placeholder="0.00"
                      style={{ width: '120px', boxSizing: 'border-box' }}
                      value={row.amount}
                      onChange={(e) => updateBatchRow(i, { amount: e.target.value })}
                    />
                    <button
                      type="button"
                      title="Remove"
                      style={{ width: '32px', height: '32px', flexShrink: 0, border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', color: '#ef4444', cursor: batchRows.length > 1 ? 'pointer' : 'not-allowed', opacity: batchRows.length > 1 ? 1 : 0.4 }}
                      disabled={batchRows.length <= 1}
                      onClick={() => setBatchRows((rows) => rows.filter((_, idx) => idx !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setBatchRows((rows) => [...rows, { workerId: '', amount: '' }])}>
                  + Add worker
                </button>

                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={() => setBatchOpen(false)}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? 'Sending…' : `Send ${batchRows.filter(r => r.workerId && r.amount).length} payment(s)`}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <p style={{ fontWeight: 600 }}>
                  Batch {batchResult.status} — {batchResult.completedCount} sent, {batchResult.failedCount} failed
                </p>
                <div className="table-responsive" style={{ marginTop: '0.5rem' }}>
                  <table className="data-table">
                    <thead><tr><th>Worker</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {batchResult.results.map((r, i) => (
                        <tr key={i}>
                          <td data-label="Worker">{workerEmail(r.workerId)}</td>
                          <td data-label="Amount">{r.amount} {r.currency}</td>
                          <td data-label="Status">
                            {r.status === 'completed'
                              ? <a href={`https://stellar.expert/explorer/testnet/tx/${r.stellarTxHash}`} target="_blank" rel="noopener noreferrer"><span className="status completed">completed</span></a>
                              : <span className="status failed" title={r.error}>failed</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="form-actions">
                  <button type="button" className="btn-primary" onClick={() => setBatchOpen(false)}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
            placeholder="Search by worker or ID…"
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
        <div className="loading">Loading payments…</div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : (
        <section className="section">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th><th>Worker</th><th>Amount</th><th>Status</th><th>Date</th><th></th>
                </tr>
              </thead>
              <tbody>
                {visiblePayments.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>No payments found.</td></tr>
                ) : visiblePayments.map((p) => (
                  <tr key={p.id} onClick={() => setDetailId(p.id)} style={{ cursor: 'pointer' }}>
                    <td data-label="ID">#{p.id.slice(0, 8)}</td>
                    <td data-label="Worker">{p.worker_email ?? p.worker_id.slice(0, 8)}</td>
                    <td data-label="Amount">{p.amount} {p.currency}</td>
                    <td data-label="Status"><span className={`status ${statusClass(p.status)}`}>{p.status}</span></td>
                    <td data-label="Date">{new Date(p.created_at).toLocaleDateString()}</td>
                    <td>
                      {p.stellar_tx_hash && (
                        <a href={`https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                          <HiOutlineArrowTopRightOnSquare size={14} />
                        </a>
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
        </section>
      )}

      <PaymentDetailModal paymentId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
