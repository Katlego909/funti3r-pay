import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore.js';
import { api } from '../api/client.js';
import './WalletInfo.css';

interface WalletData {
  userId: string;
  walletType: string;
  address?: string;
  contractAddress?: string;
  balances?: Array<{
    balance: string;
    asset_type: string;
    asset_code?: string;
  }>;
  status?: string;
}

export default function WalletInfo() {
  const user = useAuthStore((s) => s.user);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.userId) return;

    async function fetchWallet() {
      try {
        const { data } = await api.get<WalletData>(`/wallets/${user.userId}`);
        setWallet(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load wallet');
      } finally {
        setLoading(false);
      }
    }

    fetchWallet();
  }, [user]);

  if (loading) return <div className="wallet-info loading">Loading wallet...</div>;
  if (!wallet) return null;

  const xlmBalance = wallet.balances?.find((b) => b.asset_type === 'native')?.balance || '0';
  const address = wallet.address || wallet.contractAddress;
  const isSmartWallet = !!wallet.contractAddress;

  return (
    <div className="wallet-info">
      <div className="wallet-header">
        <h3>💰 Wallet</h3>
        <span className={`badge ${wallet.status?.toLowerCase() || 'unknown'}`}>
          {wallet.status || 'Active'}
        </span>
      </div>

      <div className="wallet-details">
        <div className="detail-item">
          <label>Type</label>
          <span>{isSmartWallet ? 'SmartWallet (Non-custodial)' : 'Platform (Custodial)'}</span>
        </div>

        <div className="detail-item">
          <label>XLM Balance</label>
          <span className="xlm-amount">{parseFloat(xlmBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 })} XLM</span>
        </div>

        <div className="detail-item">
          <label>{isSmartWallet ? 'Contract Address' : 'Stellar Account'}</label>
          <code className="address">{address}</code>
          {!isSmartWallet && (
            <a
              href={`https://stellar.expert/explorer/testnet/account/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="link-external"
              title="View on Stellar Expert"
            >
              ↗
            </a>
          )}
        </div>

        {wallet.balances && wallet.balances.length > 1 && (
          <div className="detail-item">
            <label>Assets</label>
            <div className="assets-list">
              {wallet.balances.map((b, i) => (
                <div key={i} className="asset">
                  <span className="asset-code">{b.asset_code || 'XLM'}</span>
                  <span className="asset-balance">{parseFloat(b.balance).toLocaleString('en-US', { maximumFractionDigits: 7 })}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
