import { useEffect, useState } from 'react';
import { HiOutlineArrowDownOnSquare } from 'react-icons/hi2';

interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  stellar_tx_hash?: string;
}

export default function PaymentHistory() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // TODO: Fetch worker's payment history from /api/payouts/worker/{workerId}
    setLoading(false);
  }, []);

  if (loading) return <div className="loading">Loading payment history...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      <h2>Payment History</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>View all payments received</p>

      {payments.length === 0 ? (
        <div style={{
          padding: '40px',
          textAlign: 'center',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          border: '1px solid #e5e7eb'
        }}>
          <HiOutlineArrowDownOnSquare size={48} style={{ color: '#d1d5db', margin: '0 auto 16px' }} />
          <p style={{ color: '#6b7280' }}>No payments yet</p>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>Amount</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '12px' }}>{p.amount} {p.currency}</td>
                <td style={{ padding: '12px' }}>
                  <span style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    backgroundColor: p.status === 'completed' ? '#d1fae5' : '#fef3c7',
                    color: p.status === 'completed' ? '#065f46' : '#92400e'
                  }}>
                    {p.status}
                  </span>
                </td>
                <td style={{ padding: '12px' }}>{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
