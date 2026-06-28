import { useEffect, useState } from 'react';
import { HiOutlineBanknotes } from 'react-icons/hi2';

interface WalletBalance {
  asset_type: string;
  asset_code?: string;
  balance: string;
}

export default function Wallet() {
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // TODO: Fetch worker's wallet balances from /api/wallets/{workerId}
    setLoading(false);
  }, []);

  if (loading) return <div className="loading">Loading wallet...</div>;
  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Wallet</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>Your account balances</p>

      <div style={{ display: 'grid', gap: '16px' }}>
        {balances.length === 0 ? (
          <div style={{
            padding: '40px',
            textAlign: 'center',
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
            border: '1px solid #e5e7eb'
          }}>
            <HiOutlineBanknotes size={48} style={{ color: '#d1d5db', margin: '0 auto 16px' }} />
            <p style={{ color: '#6b7280' }}>No wallet set up yet</p>
          </div>
        ) : (
          balances.map((balance) => (
            <div key={balance.asset_code || balance.asset_type} style={{
              padding: '16px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              border: '1px solid #e5e7eb'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontWeight: 600, margin: 0 }}>{balance.asset_code || balance.asset_type}</p>
                  <p style={{ color: '#6b7280', fontSize: '12px', margin: '4px 0 0 0' }}>{balance.asset_type}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>{balance.balance}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
