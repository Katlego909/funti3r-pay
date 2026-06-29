import { useEffect, useState } from 'react';
import { HiOutlineBanknotes } from 'react-icons/hi2';
import { useAuthStore } from '../store/authStore';

interface WalletBalance {
  asset_type: string;
  asset_code?: string;
  balance: string;
}

interface WalletInfo {
  stellarPublicKey?: string;
  balances?: WalletBalance[];
}

export default function Wallet() {
  const { user, accessToken } = useAuthStore();
  const userId = user?.userId;
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId || !accessToken) {
      setLoading(false);
      return;
    }

    fetchWallet();
  }, [userId, accessToken]);

  const fetchWallet = async () => {
    try {
      if (!userId || !accessToken) return;

      const response = await fetch(`/api/wallets/${userId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          setWalletInfo(null);
          setBalances([]);
          setLoading(false);
          return;
        }
        throw new Error(`Failed to fetch wallet: ${response.statusText}`);
      }

      const data: WalletInfo = await response.json();
      setWalletInfo(data);

      if (data.balances && Array.isArray(data.balances)) {
        setBalances(data.balances);
      }
    } catch (err) {
      console.error('Failed to fetch wallet:', err);
      setError(err instanceof Error ? err.message : 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading wallet...</div>;

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      <h2>Wallet</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>Your Stellar account and balances</p>

      {error && <div className="error-banner" style={{ marginBottom: '20px' }}>{error}</div>}

      <div style={{ display: 'grid', gap: '20px' }}>
        {/* Stellar Account Section */}
        <div>
          <h3>Stellar Account</h3>
          {walletInfo?.stellarPublicKey ? (
            <div style={{
              padding: '16px',
              backgroundColor: '#f0f7ff',
              borderRadius: '8px',
              border: '1px solid #bfdbfe',
              wordBreak: 'break-all'
            }}>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 8px 0' }}>Public Address</p>
              <p style={{ fontFamily: 'monospace', fontWeight: 600, margin: 0, fontSize: '14px' }}>
                {walletInfo.stellarPublicKey}
              </p>
            </div>
          ) : (
            <div style={{
              padding: '16px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              border: '1px solid #e5e7eb'
            }}>
              <p style={{ color: '#6b7280', margin: 0 }}>No wallet found</p>
            </div>
          )}
        </div>

        {/* Balances Section */}
        <div>
          <h3>Balances</h3>
          {balances.length === 0 ? (
            <div style={{
              padding: '40px',
              textAlign: 'center',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              border: '1px solid #e5e7eb'
            }}>
              <HiOutlineBanknotes size={48} style={{ color: '#d1d5db', margin: '0 auto 16px' }} />
              <p style={{ color: '#6b7280' }}>No balances yet. Once your wallet receives payments, they will appear here.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {balances.map((balance) => (
                <div key={balance.asset_code || balance.asset_type} style={{
                  padding: '16px',
                  backgroundColor: '#f9fafb',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <p style={{ fontWeight: 600, margin: 0 }}>{balance.asset_code || balance.asset_type}</p>
                    <p style={{ color: '#6b7280', fontSize: '12px', margin: '4px 0 0 0' }}>{balance.asset_type}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>{balance.balance}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Refresh Button */}
        <button
          onClick={() => {
            setLoading(true);
            fetchWallet();
          }}
          style={{
            padding: '10px 16px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500
          }}
        >
          Refresh Balance
        </button>
      </div>
    </div>
  );
}
