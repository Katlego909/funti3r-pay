import { useEffect, useState } from 'react';
import {
  HiOutlineBanknotes,
  HiOutlineClipboard,
  HiCheck,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineArrowPath,
} from 'react-icons/hi2';
import { toast } from 'sonner';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client.js';
import { getPayoutCurrencies, getPreferredCurrency, setPreferredCurrency, type PayoutCurrency } from '../api/payments.js';
import { CurrencyIcon } from '../components/CurrencyIcon.js';

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

const ASSET_LABELS: Record<string, string> = {
  XLM: 'Stellar Lumens',
  USDC: 'USD Coin',
  NGN: 'Nigerian Naira',
  KES: 'Kenyan Shilling',
  GHS: 'Ghanaian Cedi',
  ZAR: 'South African Rand',
  UGX: 'Ugandan Shilling',
};

function fmtBalance(n: string) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Wallet() {
  const { user } = useAuthStore();
  const userId = user?.userId;
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Payout-currency preference
  const [currencies, setCurrencies] = useState<PayoutCurrency[]>([]);
  const [preferred, setPreferred] = useState('USDC');
  const [savingPref, setSavingPref] = useState(false);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    fetchWallet();
    getPayoutCurrencies().then(setCurrencies);
    getPreferredCurrency(userId).then(setPreferred);
  }, [userId]);

  async function changePreferred(code: string) {
    setSavingPref(true);
    try {
      const saved = await setPreferredCurrency(code);
      setPreferred(saved);
      toast.success('Payout currency updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update payout currency');
    } finally {
      setSavingPref(false);
    }
  }

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
      setRefreshing(false);
    }
  };

  function copyAddress() {
    if (!address) return;
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <div className="loading">Loading wallet...</div>;

  const address = walletInfo?.address;

  return (
    <div className="dashboard" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="dashboard-header">
        <div>
          <h2>Wallet</h2>
          <p className="subtitle">Your account balances and wallet details</p>
        </div>
        <button
          className="btn-secondary"
          disabled={refreshing}
          onClick={() => { setRefreshing(true); fetchWallet(); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <HiOutlineArrowPath size={15} style={refreshing ? { animation: 'spin 0.8s linear infinite' } : undefined} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div style={{ display: 'grid', gap: '14px', marginTop: '14px' }}>
        {/* Payout currency preference */}
        <section className="section">
          <h3>Get Paid In</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <select
              value={preferred}
              disabled={savingPref}
              onChange={(e) => changePreferred(e.target.value)}
              style={{ padding: '9px 12px', borderRadius: '8px', border: '1.5px solid var(--gray-200)', fontSize: '14px', minWidth: '220px', fontFamily: 'inherit' }}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.symbol} {c.name} ({c.code})</option>
              ))}
            </select>
            <span style={{ fontSize: '13px', color: 'var(--gray-600)' }}>
              {savingPref ? 'Saving…' : 'Employers send USD — you receive this currency.'}
            </span>
          </div>
        </section>

        {/* Stellar Account */}
        <section className="section">
          <h3>Stellar Account</h3>
          {address ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '14px', color: 'var(--gray-900)' }}>
                {address.slice(0, 6)}…{address.slice(-6)}
              </span>
              <button
                className="btn-secondary"
                onClick={copyAddress}
                style={{ padding: '5px 12px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                {copied ? <><HiCheck size={14} /> Copied</> : <><HiOutlineClipboard size={14} /> Copy</>}
              </button>
              <a
                href={`https://stellar.expert/explorer/testnet/account/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}
              >
                View on Explorer <HiOutlineArrowTopRightOnSquare size={13} />
              </a>
            </div>
          ) : (
            <p className="empty-state" style={{ padding: 0 }}>No Stellar account yet.</p>
          )}
        </section>

        {/* Balances Section */}
        <section className="section">
          <h3>Balances</h3>
          {balances.length === 0 ? (
            <div className="empty-state" style={{ textAlign: 'center' }}>
              <HiOutlineBanknotes size={40} style={{ color: '#d1d5db', margin: '0 auto 12px' }} />
              <p style={{ margin: 0 }}>No balances yet. Once your wallet receives payments, they will appear here.</p>
            </div>
          ) : (
            <div className="status-list">
              {balances.map((balance) => {
                const code = balance.asset_code || (balance.asset_type === 'native' ? 'XLM' : balance.asset_type);
                return (
                  <div key={code} className="status-item" style={{ cursor: 'default' }}>
                    <span style={{ flexShrink: 0, display: 'flex' }}>
                      <CurrencyIcon code={code} size={32} />
                    </span>
                    <div>
                      <div className="status-name">{code}</div>
                      <div className="status-detail">{ASSET_LABELS[code] ?? 'Stablecoin'}</div>
                    </div>
                    <div
                      title={`${balance.balance} ${code}`}
                      style={{
                        marginLeft: 'auto',
                        fontFamily: "'Archivo Black', sans-serif",
                        fontSize: '19px',
                        fontWeight: 800,
                        color: 'var(--gray-900)',
                        letterSpacing: '-0.3px',
                      }}
                    >
                      {fmtBalance(balance.balance)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
