import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
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
import {
  getPayoutCurrencies, getPreferredCurrency, setPreferredCurrency,
  type PayoutCurrency,
} from '../api/payments.js';
import CopyButton from '../components/CopyButton.js';
import EscrowTransactionsDrawer from '../components/EscrowTransactionsDrawer.js';
import SubmitWorkModal from '../components/SubmitWorkModal.js';
import {
  listEscrows, claimMilestone, getCashoutOptions, listWalletCashouts,
  type Escrow, type WalletCashout,
} from '../api/escrows.js';
import MoneyGramCashoutModal from '../components/MoneyGramCashoutModal.js';
import CashoutsTable from '../components/CashoutsTable.js';
import WorkerMilestonesTable from '../components/WorkerMilestonesTable.js';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';

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
  // One currency for this viewer (their preferred currency): no per-asset lists.
  const dc = useDisplayCurrency();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Payout-currency preference
  const [currencies, setCurrencies] = useState<PayoutCurrency[]>([]);
  const [preferred, setPreferred] = useState('USDC');
  const [savingPref, setSavingPref] = useState(false);

  // Milestone escrows (worker side)
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [txEscrow, setTxEscrow] = useState<Escrow | null>(null);
  const [moneygramOn, setMoneygramOn] = useState(false);
  const [mgOpen, setMgOpen] = useState(false);
  const [cashouts, setCashouts] = useState<WalletCashout[]>([]);
  const [submitFor, setSubmitFor] = useState<{ escrowId: string; idx: number; title: string; previousReason?: string } | null>(null);

  function loadEscrows() {
    listEscrows().then(setEscrows).catch(() => {});
  }

  function loadCashouts() {
    listWalletCashouts().then(setCashouts).catch(() => {});
  }

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    fetchWallet();
    getPayoutCurrencies().then(setCurrencies);
    getPreferredCurrency(userId).then(setPreferred);
    loadEscrows();
    loadCashouts();
    getCashoutOptions().then((o) => setMoneygramOn(o.moneygram)).catch(() => {});
  }, [userId]);

  async function handleClaim(escrowId: string, idx: number) {
    setClaiming(`${escrowId}:${idx}`);
    try {
      const txHash = await claimMilestone(escrowId, idx);
      toast.success(`Milestone claimed — funds are in your wallet (${txHash.slice(0, 8)}…)`);
      loadEscrows();
      fetchWallet();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to claim milestone');
    } finally {
      setClaiming(null);
    }
  }

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

  if (loading) return <div className="loading">Loading wallet...</div>;

  const address = walletInfo?.address;

  return (
    <div className="dashboard" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <Helmet>
        <title>Wallet | Funti3rPay</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
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
        {/* Balance: the whole wallet as one figure in the viewer's currency */}
        <section className="section">
          <h3>Balance</h3>
          {(() => {
            const parts = balances.map((bal) => {
              const code = bal.asset_code || (bal.asset_type === 'native' ? 'XLM' : bal.asset_type);
              return dc.convert(parseFloat(bal.balance), code);
            });
            if (balances.length === 0) {
              return (
                <div className="empty-state" style={{ textAlign: 'center' }}>
                  <HiOutlineBanknotes size={40} style={{ color: '#d1d5db', margin: '0 auto 12px' }} />
                  <p style={{ margin: 0 }}>No balance yet. Once your wallet receives payments, they will appear here.</p>
                </div>
              );
            }
            // If any asset can't be priced, say so rather than quietly under-counting.
            const total = parts.every((v) => v !== null) ? (parts as number[]).reduce((sum, v) => sum + v, 0) : null;
            return (
              <div>
                <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: '28px', fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--gray-900)' }}>
                  {total !== null ? dc.formatValue(total) : '—'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--gray-600)', marginTop: 4 }}>
                  Everything in your wallet, shown in {dc.code}. Use "View on Explorer" above to see each asset.
                </div>
                {moneygramOn && (
                  <button
                    className="btn-primary"
                    style={{ marginTop: 12, padding: '9px 18px', fontSize: '0.85rem' }}
                    onClick={() => setMgOpen(true)}
                  >
                    Cash out with MoneyGram
                  </button>
                )}
              </div>
            );
          })()}
        </section>

        {/* Milestone escrows — funds locked for this worker on-chain */}
        {escrows.length > 0 && (
          <WorkerMilestonesTable
            escrows={escrows}
            busyKey={claiming}
            onClaim={handleClaim}
            onSubmitWork={setSubmitFor}
            onOpen={setTxEscrow}
          />
        )}

        <CashoutsTable cashouts={cashouts} />

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
              <CopyButton
                text={address ?? ''}
                className="btn-secondary"
                style={{ padding: '5px 12px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                label={<><HiOutlineClipboard size={14} /> Copy</>}
                copiedLabel={<><HiCheck size={14} /> Copied</>}
              />
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

        <EscrowTransactionsDrawer escrow={txEscrow} onClose={() => setTxEscrow(null)} />
        <SubmitWorkModal target={submitFor} onClose={() => setSubmitFor(null)} onDone={loadEscrows} />
        <MoneyGramCashoutModal open={mgOpen} onClose={() => setMgOpen(false)} onChanged={() => { loadCashouts(); fetchWallet(); }} />
      </div>
    </div>
  );
}
