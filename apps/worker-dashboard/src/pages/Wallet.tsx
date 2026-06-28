import { useEffect, useState } from 'react';
import { HiOutlineBanknotes } from 'react-icons/hi2';
import { useAuthStore } from '../store/authStore';
import { WalletDeploymentStatus } from '../components/WalletDeploymentStatus';

interface WalletBalance {
  asset_type: string;
  asset_code?: string;
  balance: string;
}

interface WalletInfo {
  id: string;
  contract_address?: string;
  contractAddress?: string;
  status?: string;
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
        // 404 is expected if wallet is still deploying
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

  const triggerWalletDeployment = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/wallets/deploy-for-existing-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId })
      });

      if (!response.ok) {
        throw new Error(`Failed to trigger deployment: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Wallet deployment triggered:', data);

      // Start polling for deployment status
      setWalletInfo(null);
      setError('');
      setLoading(false);

      // Trigger a refresh after a moment
      setTimeout(() => fetchWallet(), 1000);
    } catch (err) {
      console.error('Failed to trigger wallet deployment:', err);
      setError(err instanceof Error ? err.message : 'Failed to trigger wallet deployment');
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading wallet...</div>;

  const contractAddress = walletInfo?.contract_address || walletInfo?.contractAddress;

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      <h2>Wallet</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>Your account balances and wallet details</p>

      {error && <div className="error-banner" style={{ marginBottom: '20px' }}>{error}</div>}

      <WalletDeploymentStatus />

      {/* Show "Create Wallet" button if no wallet exists and not already deploying */}
      {!walletInfo && !loading && (
        <div style={{
          padding: '24px',
          backgroundColor: '#f0f7ff',
          borderRadius: '12px',
          border: '1px solid #bfdbfe',
          marginTop: '20px',
          textAlign: 'center'
        }}>
          <h3 style={{ marginTop: 0 }}>Ready to set up your wallet?</h3>
          <p style={{ color: '#4b5563', marginBottom: '20px' }}>
            Create a non-custodial SmartWallet to start receiving payments.
          </p>
          <button
            onClick={triggerWalletDeployment}
            disabled={loading}
            style={{
              padding: '12px 24px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              fontWeight: 600,
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Creating Wallet...' : 'Create Wallet'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gap: '20px', marginTop: '20px' }}>
        {/* Wallet Info Section */}
        {contractAddress && (
          <div style={{
            padding: '20px',
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
            border: '1px solid #e5e7eb'
          }}>
            <h3 style={{ marginTop: 0 }}>Wallet Address</h3>
            <div style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              padding: '12px',
              backgroundColor: 'white',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontFamily: 'monospace',
              fontSize: '12px',
              wordBreak: 'break-all'
            }}>
              <code style={{ flex: 1 }}>{contractAddress}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(contractAddress);
                  alert('Wallet address copied!');
                }}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  flexShrink: 0
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

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
