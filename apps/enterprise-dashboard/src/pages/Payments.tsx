import { useEffect, useState, FormEvent } from 'react';
import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import { listPayments, initiatePayment, type Payment } from '../api/payments.js';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/authStore.js';

interface WorkerOption { id: string; email: string }

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
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

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
        currency: 'XLM',
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

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Payments</h2>
          <p className="subtitle">Send XLM payouts to your workers on Stellar</p>
        </div>
        <button className="btn-primary" onClick={() => { setFormOpen(true); setFormSuccess(''); setFormError(''); }}>
          + New Payment
        </button>
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
                <label>Amount (XLM)
                  <input
                    type="number"
                    min="0.0000001"
                    step="0.0000001"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </label>
              </div>
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
