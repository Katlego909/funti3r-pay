import { useEffect, useState } from 'react';
import { HiOutlineBanknotes } from 'react-icons/hi2';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client.js';

interface WalletBalance {
  asset_type: string;
  asset_code?: string;
  balance: string;
}

interface WalletInfo {
  userId: string;
  walletType: string;
  address?: string | null;
  balances?: WalletBalance[];
}

export default function Wallet() {
  const { user } = useAuthStore();
  const userId = user?.userId;
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    fetchWallet();
  }, [userId]);

  const fetchWallet = async () => {
    try {
      if (!userId) return;
      setError('');
      const { data } = await api.get<WalletInfo>(`/wallets/${userId}`);
      setWalletInfo(data);
      setBalances(Array.isArray(data.balances) ? data.balances : []);
    } catch (err: any) {
      console.error('Failed to fetch wallet:', err);
      setError(err?.response?.data?.error ?? 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading wallet...</div>;

  const address = walletInfo?.address;

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      <h2>Wallet</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>Your account balances and wallet details</p>

      {error && <div className="error-banner" style={{ marginBottom: '20px' }}>{error}</div>}

      <div style={{ display: 'grid', gap: '20px', marginTop: '20px' }}>
        {/* Stellar Account */}
        <div>
          <h3>Stellar Account</h3>
          <div style={{
            padding: '16px',
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
          }}>
            {address ? (
              <a
                href={`https://stellar.expert/explorer/testnet/account/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'monospace', fontSize: '14px', wordBreak: 'break-all' }}
              >
                {address}
              </a>
            ) : (
              <p style={{ color: '#6b7280', margin: 0 }}>No Stellar account yet.</p>
            )}
          </div>
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
                    <p style={{ fontWeight: 600, margin: 0 }}>{balance.asset_code || (balance.asset_type === 'native' ? 'XLM' : balance.asset_type)}</p>
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
