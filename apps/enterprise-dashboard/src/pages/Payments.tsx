import { useEffect, useState, useRef, FormEvent, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { HiOutlineArrowTopRightOnSquare, HiOutlineMagnifyingGlass, HiOutlineXMark } from 'react-icons/hi2';
import { toast } from 'sonner';
import { exportPaymentsCSV, exportPaymentsPDF } from '../utils/export.js';
import { listPayments, initiatePayment, initiateBatchPayment, getFxRates, getXlmPrice, type Payment, type BatchResult } from '../api/payments.js';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/authStore.js';
import PaymentDetailModal from '../components/PaymentDetailModal.js';
import Modal from '../components/Modal.js';
import PageHeader from '../components/PageHeader.js';
import ExportButtons from '../components/ExportButtons.js';
import CopyButton from '../components/CopyButton.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { STATUS_TABS } from '../lib/status.js';
import { CURRENCY_META } from '../lib/currencyMeta.js';

interface WorkerOption { id: string; email: string; preferred_currency?: string; stellar_public_key?: string; payout_method?: string }
interface BatchRow { workerId: string; amountUsd: string }

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
  const [xlmUsd, setXlmUsd] = useState(0);
  const [anchorLimits, setAnchorLimits] = useState<{ minXlm: number | null; maxXlm: number | null } | null>(null);
  // Live payout method for the selected worker. The worker may have switched
  // methods (on their Wallet page) since this page's worker list was loaded,
  // so we fetch the current value rather than trust the cached list.
  const [selectedPayoutMethod, setSelectedPayoutMethod] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  // Idempotency key for the in-flight (or about-to-be-sent) payment. A ref, not
  // state: a fast double-click can fire handleSend twice before a `disabled`
  // state update paints, but a ref read is synchronous so both invocations see
  // the same value. Cleared on success/failure so the next attempt gets a fresh key.
  const sendKeyRef = useRef<string | null>(null);

  // Batch payment form state
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([{ workerId: '', amountUsd: '' }]);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const batchKeyRef = useRef<string | null>(null);

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
      const { total } = await listPayments({ limit: 1, offset: 0, ...(statusFilter !== 'all' ? { status: statusFilter } : {}) });
      const { payments: all } = await listPayments({ limit: total, offset: 0, ...(statusFilter !== 'all' ? { status: statusFilter } : {}) });
      return all;
    } finally {
      setExporting(false);
    }
  }

  const PAGE = 15;

  function loadPayments() {
    if (!user) return;
    setLoading(true);
    listPayments({
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
    getXlmPrice().then(setXlmUsd);
    api.get<{ configured: boolean; minXlm: number | null; maxXlm: number | null }>('/payouts/anchor-limits')
      .then((res) => setAnchorLimits(res.data.configured ? { minXlm: res.data.minXlm, maxXlm: res.data.maxXlm } : null))
      .catch(() => setAnchorLimits(null));
  }, []);

  const selectedWorker = workers.find((w) => w.id === workerId);

  // Refresh the selected worker's payout method live whenever the selection
  // changes — falls back to the cached list value if the lookup fails.
  useEffect(() => {
    if (!workerId) { setSelectedPayoutMethod(undefined); return; }
    let cancelled = false;
    api.get<{ payout_method?: string }>(`/users/${workerId}`)
      .then((res) => { if (!cancelled) setSelectedPayoutMethod(res.data.payout_method); })
      .catch(() => { if (!cancelled) setSelectedPayoutMethod(undefined); });
    return () => { cancelled = true; };
  }, [workerId]);

  const payCurrency = (selectedWorker?.preferred_currency || 'USDC').toUpperCase();
  const fxRate = fxRates[payCurrency] ?? (payCurrency === 'USDC' ? 1 : undefined);
  const isAnchorPayout = (selectedPayoutMethod ?? selectedWorker?.payout_method) === 'anchor';
  const anchorXlmEquivalent = isAnchorPayout && amount && xlmUsd ? Number(amount) / xlmUsd : null;
  const anchorLimitWarning =
    isAnchorPayout && anchorXlmEquivalent != null && anchorLimits?.maxXlm != null && anchorXlmEquivalent > anchorLimits.maxXlm
      ? `This worker is paid via bank/cash anchor, which caps a single disbursement at ${anchorLimits.maxXlm} XLM (≈ $${(anchorLimits.maxXlm * xlmUsd).toFixed(2)}). This payout is ≈ ${anchorXlmEquivalent.toFixed(2)} XLM — reduce the amount or it will fail.`
      : null;
  const localPreview = amount && fxRate
    ? `${(Number(amount) * fxRate).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${payCurrency}`
    : '';

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    if (!sendKeyRef.current) sendKeyRef.current = crypto.randomUUID();
    try {
      const result = await initiatePayment({
        workerId: workerId.trim(),
        amountUsd: Number(amount),
        memo: memo.trim() || undefined,
        idempotencyKey: sendKeyRef.current,
      });

      const got = result.amount != null
        ? `${Number(result.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${result.currency}`
        : result.currency;
      toast.success(`Sent $${Number(amount).toFixed(2)} — worker receives ${got}`);
      sendKeyRef.current = null;
      setFormOpen(false);
      setWorkerId('');
      setAmount('');
      setMemo('');
      loadPayments();
    } catch (err: any) {
      sendKeyRef.current = null;
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
      .filter((r) => r.workerId && r.amountUsd && Number(r.amountUsd) > 0)
      .map((r) => ({ workerId: r.workerId, amountUsd: Number(r.amountUsd) }));
    if (items.length === 0) {
      toast.error('Add at least one worker with a positive amount.');
      return;
    }
    setSubmitting(true);
    if (!batchKeyRef.current) batchKeyRef.current = crypto.randomUUID();
    try {
      const result = await initiateBatchPayment({
        items,
        idempotencyKey: batchKeyRef.current,
      });
      batchKeyRef.current = null;
      setBatchResult(result);
      loadPayments();
      if (result.failedCount === 0) {
        toast.success(`Batch complete — ${result.completedCount} payment(s) sent`);
      } else {
        toast.warning(`Batch partial — ${result.completedCount} sent, ${result.failedCount} failed`);
      }
    } catch (err: any) {
      batchKeyRef.current = null;
      toast.error(err?.response?.data?.error ?? err?.message ?? 'Batch failed');
    } finally {
      setSubmitting(false);
    }
  }

  const workerEmail = (id: string) => workers.find((w) => w.id === id)?.email ?? id.slice(0, 8);

  return (
    <div className="dashboard">
      <Helmet>
        <title>Payments | Funti3rPay</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <PageHeader
        title="Payments"
        subtitle="Send XLM or USDC payouts to your workers on Stellar"
        actions={
          <>
            <ExportButtons
              exporting={exporting}
              onCSV={async () => { const all = await fetchAllForExport(); exportPaymentsCSV(all, statusFilter !== 'all' ? `-${statusFilter}` : ''); }}
              onPDF={async () => { const all = await fetchAllForExport(); exportPaymentsPDF(all, statusFilter !== 'all' ? `-${statusFilter}` : ''); }}
            />
            <button className="btn-secondary" onClick={() => { setBatchOpen(true); setBatchResult(null); setBatchRows([{ workerId: '', amountUsd: '' }]); }}>
              Batch Payout
            </button>
            <button className="btn-cta" onClick={() => setFormOpen(true)}>
              New Payment
            </button>
          </>
        }
      />

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="New Payment">
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
                <div style={{
                  margin: '-8px 0 4px', padding: '10px 12px',
                  background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '10px',
                  fontSize: '0.78rem',
                }}>
                  <div style={{ color: '#374151', marginBottom: '8px' }}>
                    Paid in <strong>{CURRENCY_META[payCurrency]?.name ?? payCurrency} ({payCurrency})</strong>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: '5px', columnGap: '10px', alignItems: 'center' }}>
                    <span style={{ color: '#9ca3af', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Worker ID</span>
                    <span style={{ fontFamily: 'monospace', color: '#374151', wordBreak: 'break-all' }}>{workerId}</span>
                    {selectedWorker?.stellar_public_key && (
                      <>
                        <span style={{ color: '#9ca3af', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Stellar</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                          <span style={{ fontFamily: 'monospace', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedWorker.stellar_public_key}>
                            {selectedWorker.stellar_public_key}
                          </span>
                          <CopyButton
                            text={selectedWorker.stellar_public_key}
                            title="Copy Stellar address"
                            style={{ flexShrink: 0 }}
                          />
                        </span>
                      </>
                    )}
                  </div>
                </div>
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
              {workerId && isAnchorPayout && anchorXlmEquivalent != null && (
                <p style={{ margin: '-8px 0 4px', fontSize: '0.85rem', color: anchorLimitWarning ? '#b45309' : '#065f46', fontWeight: 600 }}>
                  Worker receives ≈ {anchorXlmEquivalent.toFixed(2)} XLM via bank/cash disbursement
                  <span style={{ color: '#6b7280', fontWeight: 400 }}> · paid out through the anchor, not the Stellar DEX</span>
                </p>
              )}
              {workerId && !isAnchorPayout && localPreview && (
                <p style={{ margin: '-8px 0 4px', fontSize: '0.85rem', color: '#065f46', fontWeight: 600 }}>
                  Worker receives ≈ {localPreview}
                  {payCurrency !== 'USDC' && <span style={{ color: '#6b7280', fontWeight: 400 }}> · converted from USD via the Stellar DEX</span>}
                </p>
              )}
              {anchorLimitWarning && (
                <p style={{ margin: '-4px 0 4px', fontSize: '0.8rem', color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 10px' }}>
                  ⚠ {anchorLimitWarning}
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
                <button type="submit" className="btn-primary" disabled={submitting || !!anchorLimitWarning} title={anchorLimitWarning ?? undefined}>
                  {submitting ? 'Sending…' : 'Send Payment'}
                </button>
              </div>
            </form>
      </Modal>

      <Modal open={batchOpen} onClose={() => setBatchOpen(false)} title="Batch Payout" maxWidth="560px">
            {!batchResult ? (
              <form onSubmit={handleSendBatch} className="payment-form">
                <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 0 }}>
                  Enter a USD amount per worker — each one is paid in their own preferred currency.
                </p>

                {/* Column headers (shown once) */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.78rem', fontWeight: 600, color: '#6b7280' }}>
                  <span style={{ flex: 2, minWidth: 0 }}>Worker</span>
                  <span style={{ width: '120px' }}>Amount (USD)</span>
                  <span style={{ width: '32px' }} />
                </div>

                {batchRows.map((row, i) => {
                  const rowWorker = workers.find((w) => w.id === row.workerId);
                  const rowCurrency = (rowWorker?.preferred_currency || 'USDC').toUpperCase();
                  return (
                    <div key={i}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                          type="number" min="0.01" step="0.01" placeholder="0.00"
                          style={{ width: '120px', boxSizing: 'border-box' }}
                          value={row.amountUsd}
                          onChange={(e) => updateBatchRow(i, { amountUsd: e.target.value })}
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
                      {row.workerId && (
                        <div style={{ fontSize: '0.72rem', color: '#6b7280', margin: '2px 0 0 2px' }}>
                          → worker receives {rowCurrency}
                        </div>
                      )}
                    </div>
                  );
                })}

                <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setBatchRows((rows) => [...rows, { workerId: '', amountUsd: '' }])}>
                  + Add worker
                </button>

                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={() => setBatchOpen(false)}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={submitting}>
                    {submitting ? 'Sending…' : `Send ${batchRows.filter(r => r.workerId && r.amountUsd).length} payment(s)`}
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
                              ? <a href={`https://stellar.expert/explorer/testnet/tx/${r.stellarTxHash}`} target="_blank" rel="noopener noreferrer"><StatusBadge variant="completed">completed</StatusBadge></a>
                              : <StatusBadge variant="failed" title={r.error}>failed</StatusBadge>}
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
      </Modal>

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
                    <td data-label="Status"><StatusBadge status={p.status} /></td>
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
