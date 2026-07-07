import { useEffect, useState } from 'react';
import { HiOutlineClipboard, HiCheck, HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import { useAuthStore } from '../store/authStore.js';
import { api } from '../api/client.js';
import './WalletInfo.css';

interface WalletData {
  userId: string;
  walletType: string;
  address?: string;
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user?.userId) return;

    async function fetchWallet() {
      try {
        const { data } = await api.get<WalletData>(`/wallets/${user!.userId}`);
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
  if (error) return <div className="wallet-info loading" style={{ color: '#ef4444' }}>{error}</div>;
  if (!wallet) return null;

  const xlmBalance = wallet.balances?.find((b) => b.asset_type === 'native')?.balance || '0';
  const address = wallet.address;
  const isEnterprise = user?.role !== 'worker';

  function copyAddress() {
    if (!address) return;
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="wallet-info">
      <div className="wallet-details">
        <div className="detail-item" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <label>Type</label>
            <span style={{ display: 'block', marginTop: 4 }}>Platform (Custodial)</span>
          </div>
          <span className={`status ${!wallet.status || wallet.status.toLowerCase() === 'active' ? 'completed' : 'pending'}`}>
            {wallet.status || 'Active'}
          </span>
        </div>

        <div className="detail-item">
          <label>XLM Balance</label>
          <span className="xlm-amount">
            {parseFloat(xlmBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 })} XLM
          </span>
        </div>

        {address && (
          <div className="detail-item">
            <label>Stellar Account</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f7f8fa', border: '1px solid #e8eaed', borderRadius: 8, padding: '8px 12px' }}>
              <code className="address" style={{ flex: 1, fontSize: '0.78rem', fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--gray-700)' }}>
                {address}
              </code>
              <button
                onClick={copyAddress}
                title="Copy address"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--gray-600)', padding: '2px 4px', flexShrink: 0, display: 'flex' }}
              >
                {copied ? <HiCheck size={15} /> : <HiOutlineClipboard size={15} />}
              </button>
              <a
                href={`https://stellar.expert/explorer/testnet/account/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on Stellar Explorer"
                style={{ color: 'var(--gray-600)', display: 'flex', flexShrink: 0, padding: '2px 4px' }}
              >
                <HiOutlineArrowTopRightOnSquare size={15} />
              </a>
            </div>
          </div>
        )}

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

        {/* Testnet funding for enterprise only */}
        {isEnterprise && address && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '14px 16px' }}>
            <p style={{ margin: '0 0 4px', fontSize: '0.82rem', fontWeight: 600, color: '#1d4ed8' }}>Fund with Friendbot (Testnet)</p>
            <p style={{ margin: '0 0 10px', fontSize: '0.79rem', color: '#3b82f6' }}>
              Click below to receive 10,000 free XLM on the Stellar testnet.
            </p>
            <a
              href={`https://friendbot.stellar.org/?addr=${address}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: '#1d4ed8', color: '#fff', borderRadius: '6px', textDecoration: 'none', fontSize: '0.82rem', fontWeight: 600 }}
            >
              Fund via Friendbot <HiOutlineArrowTopRightOnSquare size={13} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
