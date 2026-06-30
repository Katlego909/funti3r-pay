import { useEffect, useState, FormEvent } from 'react';
import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import { listPayments, initiatePayment, initiateBatchPayment, type Payment, type BatchResult } from '../api/payments.js';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/authStore.js';

interface WorkerOption { id: string; email: string }
interface BatchRow { workerId: string; amount: string }

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
  const [currency, setCurrency] = useState<'XLM' | 'USDC'>('XLM');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Batch payment form state
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchCurrency, setBatchCurrency] = useState<'XLM' | 'USDC'>('XLM');
  const [batchRows, setBatchRows] = useState<BatchRow[]>([{ workerId: '', amount: '' }]);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [batchError, setBatchError] = useState('');

  const PAGE = 15;

  function loadPayments() {
    if (!user) return;
    setLoading(true);
    listPayments({ enterpriseId: user.userId, limit: PAGE, offset })
      .then(({ payments: p, total: t }) => { setPayments(p); setTotal(t); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadPayments();
  }, [user, offset]);

  // Load the worker list once for the payment dropdown.
  useEffect(() => {
    api.get<{ users?: WorkerOption[] }>('/users?role=worker&limit=100')
      .then((res) => setWorkers(res.data.users ?? []))
      .catch(() => setWorkers([]));
  }, []);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    setSubmitting(true);
    try {
      const result = await initiatePayment({
        enterpriseId: user!.userId,
        workerId: workerId.trim(),
        amount: Number(amount),
        currency,
        memo: memo.trim() || undefined,
      });

      setFormSuccess(`Payment ${result.status} — ${result.stellarTxHash?.slice(0, 12)}…`);
      setFormOpen(false);
      setWorkerId('');
      setAmount('');
      setMemo('');
      loadPayments();
    } catch (err: any) {
      setFormError(err?.response?.data?.error ?? err?.message ?? 'Payment failed');
    } finally {
      setSubmitting(false);
    }
  }

  function updateBatchRow(i: number, patch: Partial<BatchRow>) {
    setBatchRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function handleSendBatch(e: FormEvent) {
    e.preventDefault();
    setBatchError('');
    setBatchResult(null);
    const items = batchRows
      .filter((r) => r.workerId && r.amount && Number(r.amount) > 0)
      .map((r) => ({ workerId: r.workerId, amount: Number(r.amount) }));
    if (items.length === 0) {
      setBatchError('Add at least one worker with a positive amount.');
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
    } catch (err: any) {
      setBatchError(err?.response?.data?.error ?? err?.message ?? 'Batch failed');
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={() => { setBatchOpen(true); setBatchResult(null); setBatchError(''); setBatchRows([{ workerId: '', amount: '' }]); }}>
            Batch Payout
          </button>
          <button className="btn-primary" onClick={() => { setFormOpen(true); setFormSuccess(''); setFormError(''); }}>
            + New Payment
          </button>
        </div>
      </div>

      {formSuccess && <div className="success-banner">{formSuccess}</div>}

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
                <p style={{ margin: '-8px 0 4px', fontSize: '0.78rem', color: '#6b7280', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  Worker ID: {workerId}
                </p>
              )}
              <div className="form-row">
                <label>Amount
                  <input
                    type="number"
                    min="0.0000001"
                    step="0.0000001"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </label>
                <label>Currency
                  <select value={currency} onChange={(e) => setCurrency(e.target.value as 'XLM' | 'USDC')}>
                    <option value="XLM">XLM</option>
                    <option value="USDC">USDC</option>
                  </select>
                </label>
              </div>
              {currency === 'USDC' && (
                <p style={{ margin: '-8px 0 4px', fontSize: '0.78rem', color: '#6b7280' }}>
                  Worker receives exactly {amount || '0'} USDC; funded from your XLM via the Stellar DEX.
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

              {formError && <p className="auth-error">{formError}</p>}
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

                {batchError && <p className="auth-error">{batchError}</p>}
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
                <table className="data-table" style={{ marginTop: '0.5rem' }}>
                  <thead><tr><th>Worker</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {batchResult.results.map((r, i) => (
                      <tr key={i}>
                        <td>{workerEmail(r.workerId)}</td>
                        <td>{r.amount} {r.currency}</td>
                        <td>
                          {r.status === 'completed'
                            ? <a href={`https://stellar.expert/explorer/testnet/tx/${r.stellarTxHash}`} target="_blank" rel="noopener noreferrer"><span className="status completed">completed</span></a>
                            : <span className="status failed" title={r.error}>failed</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="form-actions">
                  <button type="button" className="btn-primary" onClick={() => setBatchOpen(false)}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading payments…</div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : (
        <section className="section">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th><th>Worker</th><th>Amount</th><th>Status</th><th>Date</th><th></th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>No payments found.</td></tr>
              ) : payments.map((p) => (
                <tr key={p.id}>
                  <td>#{p.id.slice(0, 8)}</td>
                  <td>{p.worker_email ?? p.worker_id.slice(0, 8)}</td>
                  <td>{p.amount} {p.currency}</td>
                  <td><span className={`status ${statusClass(p.status)}`}>{p.status}</span></td>
                  <td>{new Date(p.created_at).toLocaleDateString()}</td>
                  <td>
                    {p.stellar_tx_hash && (
                      <a href={`https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`} target="_blank" rel="noopener noreferrer">
                        <HiOutlineArrowTopRightOnSquare size={14} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Prev</button>
            <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
            <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next →</button>
          </div>
        </section>
      )}
    </div>
  );
}
