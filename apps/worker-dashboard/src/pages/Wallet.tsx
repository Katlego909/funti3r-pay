import { useEffect, useState } from 'react';
import { HiOutlineBanknotes, HiXMark } from 'react-icons/hi2';
import { useAuthStore } from '../store/authStore';
import { WalletDeploymentStatus } from '../components/WalletDeploymentStatus';
import WalletLinking from '../components/WalletLinking';

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
  const [externalWallets, setExternalWallets] = useState<any[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);

  useEffect(() => {
    if (!userId || !accessToken) {
      setLoading(false);
      return;
    }

    fetchWallet();
    loadExternalWallets();
  }, [userId, accessToken]);

  const loadExternalWallets = async () => {
    try {
      setLoadingWallets(true);
      const response = await fetch(`/api/wallets/${userId}/external`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (response.ok) {
        const data = await response.json();
        setExternalWallets(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load external wallets:', err);
    } finally {
      setLoadingWallets(false);
    }
  };

  const handleDisconnectWallet = async (walletId: string) => {
    if (!confirm('Disconnect this wallet?')) return;
    try {
      const response = await fetch(`/api/wallets/external/disconnect/${walletId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (response.ok) {
        loadExternalWallets();
      }
    } catch (err) {
      console.error('Failed to disconnect wallet:', err);
    }
  };

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

  const contractAddress = walletInfo?.contract_address || walletInfo?.contractAddress;

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      <h2>Wallet</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>Your account balances and wallet details</p>

      {error && <div className="error-banner" style={{ marginBottom: '20px' }}>{error}</div>}

      <WalletDeploymentStatus />

      <div style={{ display: 'grid', gap: '20px', marginTop: '20px' }}>
        {/* External Wallets Section */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>External Wallets</h3>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>Freighter, Albedo, Rabet, etc.</span>
          </div>

          {externalWallets.length > 0 ? (
            <div style={{ display: 'grid', gap: '12px', marginBottom: '16px' }}>
              {externalWallets.map((wallet: any) => (
                <div key={wallet.id} style={{
                  padding: '16px',
                  backgroundColor: '#f0f7ff',
                  borderRadius: '8px',
                  border: '1px solid #bfdbfe',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <p style={{ fontWeight: 600, margin: 0 }}>{wallet.public_key?.slice(0, 10)}...{wallet.public_key?.slice(-10)}</p>
                    <p style={{ color: '#6b7280', fontSize: '12px', margin: '4px 0 0 0' }}>{wallet.wallet_provider}</p>
                  </div>
                  <button
                    onClick={() => handleDisconnectWallet(wallet.id)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#fecaca',
                      color: '#991b1b',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <HiXMark size={14} />
                    Disconnect
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              padding: '16px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              marginBottom: '16px'
            }}>
              <p style={{ color: '#6b7280', margin: 0 }}>No external wallets linked yet.</p>
            </div>
          )}

          <WalletLinking userId={userId!} onLinked={loadExternalWallets} />
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
