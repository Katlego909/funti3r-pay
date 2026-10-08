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
  getPayoutMethod, setPayoutMethod, type PayoutCurrency, type PayoutMethod,
} from '../api/payments.js';
import CopyButton from '../components/CopyButton.js';
import EscrowTransactionsDrawer from '../components/EscrowTransactionsDrawer.js';
import SubmitWorkModal from '../components/SubmitWorkModal.js';
import {
  listEscrows, claimMilestone, cashOutMilestone, getCashoutOptions, listWalletCashouts,
  type CashoutResult, type Escrow, type WalletCashout,
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

  // Payout method (Stellar wallet vs anchor bank/cash disbursement)
  const [payoutMethod, setPayoutMethodState] = useState<PayoutMethod>('stellar');
  const [anchorDetails, setAnchorDetails] = useState<Record<string, string>>({});
  const [savingMethod, setSavingMethod] = useState(false);

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
    getPayoutMethod(userId).then((info) => {
      setPayoutMethodState(info.method);
      setAnchorDetails(info.details ?? {});
    });
    loadEscrows();
    loadCashouts();
    getCashoutOptions().then((o) => setMoneygramOn(o.moneygram)).catch(() => {});
  }, [userId]);

  async function changePayoutMethod(method: PayoutMethod) {
    setPayoutMethodState(method);
    if (method === 'stellar') {
      setSavingMethod(true);
      try {
        await setPayoutMethod('stellar');
        toast.success('Payouts go straight to your Stellar wallet');
      } catch (err: any) {
        toast.error(err?.response?.data?.error ?? 'Failed to update payout method');
      } finally {
        setSavingMethod(false);
      }
    }
    // 'anchor' persists on Save, once the details are filled in.
  }

  async function saveAnchorDetails() {
    setSavingMethod(true);
    try {
      await setPayoutMethod('anchor', anchorDetails);
      toast.success('Payouts will be disbursed to your bank / cash pickup');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to save payout details');
    } finally {
      setSavingMethod(false);
    }
  }

  function reportCashout(cashout: CashoutResult) {
    if (cashout.status === 'completed') {
      toast.success('Cash-out sent to your anchor — track it from the milestone');
    } else if (cashout.status === 'action_required') {
      toast('Your anchor needs one more step — use "Complete anchor step" below', { icon: 'ℹ️' });
    } else {
      toast.error(cashout.error ?? 'Cash-out failed — your funds are safe in your wallet, retry any time');
    }
  }

  async function handleClaim(escrowId: string, idx: number) {
    setClaiming(`${escrowId}:${idx}`);
    try {
      // Workers who chose bank/cash payouts claim and cash out in one step.
      const { txHash, cashout } = await claimMilestone(
        escrowId, idx, payoutMethod === 'anchor' ? { cashout: 'anchor' } : undefined,
      );
      toast.success(`Milestone claimed — funds are in your wallet (${txHash.slice(0, 8)}…)`);
      if (cashout) reportCashout(cashout);
      loadEscrows();
      fetchWallet();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to claim milestone');
    } finally {
      setClaiming(null);
    }
  }

  async function handleCashout(escrowId: string, idx: number) {
    setClaiming(`${escrowId}:${idx}`);
    try {
      reportCashout(await cashOutMilestone(escrowId, idx));
      loadEscrows();
      fetchWallet();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to cash out milestone');
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

          {/* Payout method: on-chain wallet vs anchor disbursement */}
          <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--gray-200)' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--gray-700)', marginBottom: '8px' }}>
              How you receive payouts
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <select
                value={payoutMethod}
                disabled={savingMethod}
                onChange={(e) => changePayoutMethod(e.target.value as PayoutMethod)}
                style={{ padding: '9px 12px', borderRadius: '8px', border: '1.5px solid var(--gray-200)', fontSize: '14px', minWidth: '220px', fontFamily: 'inherit' }}
              >
                <option value="stellar">Stellar wallet (on-chain)</option>
                <option value="anchor">Bank / cash pickup (via anchor)</option>
              </select>
              {payoutMethod === 'stellar' && (
                <span style={{ fontSize: '13px', color: 'var(--gray-600)' }}>Funds arrive directly in the wallet below.</span>
              )}
            </div>

            {payoutMethod === 'anchor' && (
              <div style={{ marginTop: '12px' }}>
                <p style={{ fontSize: '13px', color: 'var(--gray-600)', margin: '0 0 10px' }}>
                  Payouts are converted and disbursed through a regulated Stellar anchor.
                  The anchor needs these details to pay you out:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', maxWidth: '640px' }}>
                  {([
                    ['first_name', 'First name', 'text'],
                    ['last_name', 'Last name', 'text'],
                    ['email_address', 'Email', 'email'],
                    ['birth_date', 'Date of birth', 'date'],
                    ['bank_account_number', 'Bank account number', 'text'],
                    ['bank_number', 'Bank routing number', 'text'],
                  ] as const).map(([key, label, type]) => (
                    <label key={key} style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--gray-700)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {label}
                      <input
                        type={type}
                        value={anchorDetails[key] ?? ''}
                        onChange={(e) => setAnchorDetails((d) => ({ ...d, [key]: e.target.value }))}
                        style={{ padding: '8px 10px', borderRadius: '8px', border: '1.5px solid var(--gray-200)', fontSize: '13px', fontFamily: 'inherit', fontWeight: 400 }}
                      />
                    </label>
                  ))}
                </div>
                <button
                  className="btn-primary"
                  style={{ marginTop: '12px', padding: '9px 18px', fontSize: '0.85rem' }}
                  disabled={savingMethod || !anchorDetails.first_name || !anchorDetails.last_name}
                  onClick={saveAnchorDetails}
                >
                  {savingMethod ? 'Saving…' : 'Save payout details'}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Milestone escrows — funds locked for this worker on-chain */}
        {escrows.length > 0 && (
          <WorkerMilestonesTable
            escrows={escrows}
            payoutMethod={payoutMethod}
            moneygramOn={moneygramOn}
            busyKey={claiming}
            onClaim={handleClaim}
            onCashout={handleCashout}
            onSubmitWork={setSubmitFor}
            onOpen={setTxEscrow}
          />
        )}

        <EscrowTransactionsDrawer escrow={txEscrow} onClose={() => setTxEscrow(null)} />
        <SubmitWorkModal target={submitFor} onClose={() => setSubmitFor(null)} onDone={loadEscrows} />
        <MoneyGramCashoutModal open={mgOpen} onClose={() => setMgOpen(false)} onChanged={() => { loadCashouts(); fetchWallet(); }} />

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

        <CashoutsTable cashouts={cashouts} />
      </div>
    </div>
  );
}
