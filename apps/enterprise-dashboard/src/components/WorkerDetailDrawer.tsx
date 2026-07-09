import { useEffect, useState } from 'react';
import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import { api } from '../api/client.js';
import { getFxRates, getXlmPrice } from '../api/payments.js';
import SlideOver, { Row, SectionTitle } from './SlideOver.js';
import CopyButton from './CopyButton.js';
import { StatusBadge } from './StatusBadge.js';
import { CURRENCY_META } from '../lib/currencyMeta.js';

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

const fmt = (n: string | number, d = 2) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : '—');
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

export default function WorkerDetailDrawer({ workerId, onClose }: { workerId: string | null; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [kyc, setKyc] = useState<string>('none');
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [xlmUsd, setXlmUsd] = useState(0);
  const [fx, setFx] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!workerId) return;
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
  }, [workerId]);

  const pref = (profile?.preferred_currency || 'USDC').toUpperCase();
  const completed = payments.filter((p) => p.status === 'completed');
  const totalUsd = completed.reduce((s, p) => s + usdOf(p.currency, Number(p.amount), xlmUsd, fx), 0);
  const balances = (wallet?.balances ?? []).filter((b) => Number(b.balance) > 0);

  return (
    <SlideOver openKey={workerId} title="Worker Details" onClose={onClose} width={480}>

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
                <StatusBadge status={profile.status}>{profile.status ?? 'active'}</StatusBadge>
                <StatusBadge status={kyc}>KYC {kyc}</StatusBadge>
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
              <CopyButton text={profile.id} style={{ marginLeft: 6, verticalAlign: 'middle' }} />
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
                    <StatusBadge status={p.status} style={{ fontSize: '0.62rem' }} />
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
    </SlideOver>
  );
}
