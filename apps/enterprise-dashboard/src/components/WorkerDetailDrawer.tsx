import { useEffect, useState, useCallback } from 'react';
import { HiXMark, HiOutlineArrowTopRightOnSquare, HiOutlineClipboard, HiCheck } from 'react-icons/hi2';
import { api } from '../api/client.js';
import { getFxRates, getXlmPrice } from '../api/payments.js';

interface Profile {
  id: string; email: string; status?: string; country?: string | null;
  preferred_currency?: string; created_at: string;
}
interface Balance { asset_type: string; asset_code?: string; balance: string }
interface WalletInfo { address?: string | null; balances?: Balance[] }
interface PaymentRow {
  id: string; amount: string | number; currency: string; status: string;
  stellar_tx_hash?: string | null; created_at: string;
}

const CURRENCY_META: Record<string, { name: string; symbol: string; color: string }> = {
  XLM: { name: 'Stellar Lumens', symbol: 'XLM', color: '#3b82f6' },
  USDC: { name: 'USD Coin', symbol: '$', color: '#16a34a' },
  NGN: { name: 'Nigerian Naira', symbol: '₦', color: '#f59e0b' },
  KES: { name: 'Kenyan Shilling', symbol: 'KSh', color: '#8b5cf6' },
  GHS: { name: 'Ghanaian Cedi', symbol: 'GH₵', color: '#ec4899' },
  ZAR: { name: 'South African Rand', symbol: 'R', color: '#06b6d4' },
  UGX: { name: 'Ugandan Shilling', symbol: 'USh', color: '#ef4444' },
};
const fmt = (n: string | number, d = 2) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : '—');
function statusClass(s?: string) {
  if (s === 'completed' || s === 'verified' || s === 'approved') return 'completed';
  if (s === 'failed' || s === 'rejected') return 'failed';
  return 'pending';
}
function kycLabel(s?: string) {
  if (s === 'verified' || s === 'approved') return 'verified';
  if (s === 'rejected') return 'rejected';
  if (!s || s === 'none') return 'none';
  return 'pending';
}

function usdOf(currency: string, amount: number, xlmUsd: number, fx: Record<string, number>): number {
  if (currency === 'XLM') return amount * xlmUsd;
  if (currency === 'USDC') return amount;
  const r = Number(fx[currency]);
  return r > 0 ? amount / r : 0;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ color: '#6b7280', fontSize: '0.82rem' }}>{label}</span>
      <span style={{ fontSize: '0.85rem', fontWeight: 500, textAlign: 'right', wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 style={{ margin: '20px 0 6px', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#6b7280' }}>{children}</h4>;
}

export default function WorkerDetailDrawer({ workerId, onClose }: { workerId: string | null; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [kyc, setKyc] = useState<string>('none');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [xlmUsd, setXlmUsd] = useState(0);
  const [fx, setFx] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (!workerId) return;
    setMounted(true);
    const raf = requestAnimationFrame(() => setVisible(true));
    setLoading(true); setError('');
    setProfile(null); setWallet(null); setKyc('none'); setPayments([]);

    Promise.allSettled([
      api.get<Profile>(`/users/${workerId}`),
      api.get<WalletInfo>(`/wallets/${workerId}`),
      api.get<{ status?: string }>(`/compliance/${workerId}/status`),
      api.get<{ payments: PaymentRow[] }>(`/payouts?workerId=${workerId}&limit=50`),
      getXlmPrice(),
      getFxRates(),
    ]).then(([pr, wl, kc, pay, price, rates]) => {
      if (pr.status === 'fulfilled') setProfile(pr.value.data); else setError('Failed to load worker');
      if (wl.status === 'fulfilled') setWallet(wl.value.data);
      if (kc.status === 'fulfilled') setKyc(kycLabel(kc.value.data.status));
      if (pay.status === 'fulfilled') setPayments(pay.value.data.payments ?? []);
      if (price.status === 'fulfilled') setXlmUsd(price.value);
      if (rates.status === 'fulfilled') setFx(rates.value);
    }).finally(() => setLoading(false));

    return () => cancelAnimationFrame(raf);
  }, [workerId]);

  const handleClose = useCallback(() => {
    setVisible(false);
    window.setTimeout(() => { setMounted(false); onClose(); }, 220);
  }, [onClose]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, handleClose]);

  if (!mounted) return null;

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key); setTimeout(() => setCopied(''), 1500);
  };

  const pref = (profile?.preferred_currency || 'USDC').toUpperCase();
  const completed = payments.filter((p) => p.status === 'completed');
  const totalUsd = completed.reduce((s, p) => s + usdOf(p.currency, Number(p.amount), xlmUsd, fx), 0);
  const balances = (wallet?.balances ?? []).filter((b) => Number(b.balance) > 0);

  return (
    <div
      onClick={handleClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: `rgba(15,23,42,${visible ? 0.4 : 0})`, transition: 'background 0.25s ease' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', top: 0, right: 0, height: '100vh', width: 'min(480px, 94vw)',
          background: '#fff', boxShadow: '-10px 0 40px rgba(0,0,0,0.18)', overflowY: 'auto', padding: '1.5rem',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)', zIndex: 1001, display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h3 style={{ margin: 0 }}>Worker Details</h3>
          <button onClick={handleClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
            <HiXMark size={22} />
          </button>
        </div>

        {loading ? (
          <div style={{ marginTop: '1rem' }} aria-busy="true">
            <div style={{ height: 84, borderRadius: 12, background: '#f1f5f9', marginBottom: 16 }} />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ width: 90, height: 11, borderRadius: 4, background: '#eef2f7' }} />
                <div style={{ width: 150, height: 11, borderRadius: 4, background: '#e2e8f0' }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="error-banner" style={{ marginTop: '1rem' }}>{error}</div>
        ) : profile ? (
          <div style={{ marginTop: '1rem' }}>
            {/* Header card */}
            <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '8px' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, wordBreak: 'break-all' }}>{profile.email}</div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                <span className={`status ${statusClass(profile.status)}`}>{profile.status ?? 'active'}</span>
                <span className={`status ${statusClass(kyc)}`}>KYC {kyc}</span>
              </div>
              <div style={{ marginTop: '12px', fontSize: '0.8rem', color: '#6b7280' }}>Total received from you</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>${fmt(totalUsd)} <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#6b7280' }}>· {completed.length} payments</span></div>
            </div>

            <SectionTitle>Account</SectionTitle>
            <Row label="Gets paid in">
              <span style={{ color: CURRENCY_META[pref]?.color }}>{CURRENCY_META[pref]?.symbol} {CURRENCY_META[pref]?.name ?? pref} ({pref})</span>
            </Row>
            <Row label="Joined">{fmtDate(profile.created_at)}</Row>
            {profile.country && <Row label="Country">{profile.country}</Row>}
            <Row label="Worker ID">
              <span style={{ fontFamily: 'monospace', fontSize: '0.76rem' }}>{profile.id.slice(0, 8)}…</span>
              <button onClick={() => copy(profile.id, 'id')} title="Copy" style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', verticalAlign: 'middle' }}>
                {copied === 'id' ? <HiCheck size={14} /> : <HiOutlineClipboard size={14} />}
              </button>
            </Row>

            <SectionTitle>Stellar account</SectionTitle>
            {wallet?.address ? (
              <Row label="Address">
                <a href={`https://stellar.expert/explorer/testnet/account/${wallet.address}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                  {wallet.address.slice(0, 6)}…{wallet.address.slice(-6)}
                </a>
              </Row>
            ) : <Row label="Address">—</Row>}
            {balances.length > 0 ? balances.map((b) => {
              const code = b.asset_type === 'native' ? 'XLM' : (b.asset_code ?? '?');
              return <Row key={code} label={`${CURRENCY_META[code]?.name ?? code} balance`}><span style={{ color: CURRENCY_META[code]?.color }}>{fmt(b.balance, 7)} {code}</span></Row>;
            }) : <Row label="Balance">No funds yet</Row>}

            <SectionTitle>Payments to this worker</SectionTitle>
            {payments.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No payments yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {payments.slice(0, 12).map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 10px', background: '#f9fafb', border: '1px solid #f1f5f9', borderRadius: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.84rem' }}>{fmt(p.amount, 2)} {p.currency}</span>
                    <span className={`status ${statusClass(p.status)}`} style={{ fontSize: '0.62rem' }}>{p.status}</span>
                    <span style={{ fontSize: '0.74rem', color: '#6b7280' }}>{fmtDate(p.created_at)}</span>
                    {p.stellar_tx_hash
                      ? <a href={`https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`} target="_blank" rel="noopener noreferrer"><HiOutlineArrowTopRightOnSquare size={13} /></a>
                      : <span style={{ width: 13 }} />}
                  </div>
                ))}
                {payments.length > 12 && <span style={{ fontSize: '0.76rem', color: '#9ca3af', marginTop: '2px' }}>+ {payments.length - 12} more</span>}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
