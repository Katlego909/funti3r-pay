import { useEffect, useState } from 'react';
import { HiOutlineArrowDownOnSquare, HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import { listPayments, type Payment } from '../api/payments.js';
import { useAuthStore } from '../store/authStore.js';
import PaymentDetailModal from '../components/PaymentDetailModal.js';
import '../styles/Dashboard.css';

function statusClass(s: string) {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  return 'pending';
}

export default function PaymentHistory() {
  const user = useAuthStore((s) => s.user);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const PAGE = 20;

  useEffect(() => {
    if (!user?.userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    listPayments({ workerId: user.userId, limit: PAGE, offset })
      .then(({ payments: p, total: t }) => { setPayments(p); setTotal(t); setError(''); })
      .catch((err: any) => setError(err?.response?.data?.error ?? 'Failed to load payment history'))
      .finally(() => setLoading(false));
  }, [user, offset]);

  if (loading) return <div className="loading">Loading payment history…</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Payment History</h2>
          <p className="subtitle">View all payments received</p>
        </div>
      </div>

      <section className="section">
        {payments.length === 0 ? (
          <div className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <HiOutlineArrowDownOnSquare size={48} style={{ color: '#d1d5db', margin: '0 auto 1rem' }} />
            <p>No payments yet.</p>
          </div>
        ) : (
          <>
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
                {payments.map((p) => (
                  <tr key={p.id} onClick={() => setDetailId(p.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600 }}>{p.amount} {p.currency}</td>
                    <td><span className={`status ${statusClass(p.status)}`}>{p.status}</span></td>
                    <td>{new Date(p.created_at).toLocaleString()}</td>
                    <td>
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

            <div className="pagination">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Prev</button>
              <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
              <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next →</button>
            </div>
          </>
        )}
      </section>

      <PaymentDetailModal paymentId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
