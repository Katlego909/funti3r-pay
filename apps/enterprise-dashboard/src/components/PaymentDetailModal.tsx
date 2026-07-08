import { useEffect, useState } from 'react';
import { HiOutlineArrowTopRightOnSquare, HiOutlineClipboard, HiCheck, HiOutlineArrowPath, HiOutlineArrowDownTray } from 'react-icons/hi2';
import { api } from '../api/client.js';
import { initiatePayment } from '../api/payments.js';
import { generatePayslip, formatCompanyLabel } from '../utils/export.js';
import SlideOver, { Row } from './SlideOver.js';
import { statusClass } from '../lib/status.js';
import { currencyColor } from '../lib/currencyMeta.js';

interface PaymentDetail {
  id: string;
  enterprise_id: string;
  worker_id: string;
  amount: string | number;
  currency: string;
  status: string;
  stellar_tx_hash?: string | null;
  stellar_destination?: string | null;
  memo?: string | null;
  failure_reason?: string | null;
  fee_paid_xlm?: string | null;
  batch_id?: string | null;
  idempotency_key?: string | null;
  company_name?: string | null;
  created_at: string;
  completed_at?: string | null;
  failed_at?: string | null;
  worker_email?: string | null;
  enterprise_email?: string | null;
  usd_value?: number;
  fx_rate?: number | null;
}

const fmtAmt = (n: string | number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 7 });
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString() : '—');

export default function PaymentDetailModal({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const [p, setP] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [retrySuccess, setRetrySuccess] = useState(false);

  useEffect(() => {
    if (!paymentId) return;
    setLoading(true);
    setError('');
    setP(null);
    api.get<PaymentDetail>(`/payouts/${paymentId}`)
      .then((r) => setP(r.data))
      .catch((e: any) => setError(e?.response?.data?.error ?? 'Failed to load payment'))
      .finally(() => setLoading(false));
  }, [paymentId]);

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };

  async function handleRetry() {
    if (!p) return;
    setRetrying(true);
    setRetryError('');
    setRetrySuccess(false);
    try {
      // Reuse the original idempotency key so this hits the backend's
      // resume-a-failed-payment path (same paymentId) rather than creating a
      // second real payment; legacy rows predating the column get a fresh key.
      await initiatePayment({
        workerId: p.worker_id,
        amount: Number(p.amount),
        currency: p.currency,
        idempotencyKey: p.idempotency_key ?? crypto.randomUUID(),
      });
      setRetrySuccess(true);
      // Reload payment details after short delay
      setTimeout(() => {
        setLoading(true);
        setRetrySuccess(false);
        api.get<PaymentDetail>(`/payouts/${paymentId}`)
          .then((r) => setP(r.data))
          .catch((e: any) => setError(e?.response?.data?.error ?? 'Failed to reload payment'))
          .finally(() => setLoading(false));
      }, 1200);
    } catch (e: any) {
      setRetryError(e?.response?.data?.error ?? 'Retry failed. Please try again.');
    } finally {
      setRetrying(false);
    }
  }

  const color = p ? currencyColor(p.currency, '#374151') : '#374151';
  const isConverted = p && p.currency !== 'USDC' && p.fx_rate; // USD → local conversion happened

  return (
    <SlideOver openKey={paymentId} title="Payment Details" onClose={onClose}>
        {loading ? (
          // Full-size skeleton so the modal opens at its final height (no jump).
          <div style={{ marginTop: '1rem' }} aria-busy="true">
            <div style={{ height: 104, borderRadius: 12, background: '#f1f5f9', marginBottom: 16 }} />
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ width: 90, height: 11, borderRadius: 4, background: '#eef2f7' }} />
                <div style={{ width: 150, height: 11, borderRadius: 4, background: '#e2e8f0' }} />
              </div>
            ))}
            <div style={{ height: 38, width: 210, borderRadius: 8, background: '#e2e8f0', marginTop: 16 }} />
          </div>
        ) : error ? (
          <div className="error-banner" style={{ marginTop: '1rem' }}>{error}</div>
        ) : p ? (
          <div style={{ marginTop: '1rem' }}>
            {/* Headline amount */}
            <div style={{
              background: `${color}0d`, border: `1px solid ${color}33`, borderRadius: '12px',
              padding: '16px', marginBottom: '16px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '1.9rem', fontWeight: 800, color }}>
                {fmtAmt(p.amount)} <span style={{ fontSize: '0.55em' }}>{p.currency}</span>
              </div>
              {p.usd_value != null && (
                <div style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '2px' }}>≈ ${p.usd_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</div>
              )}
              <span className={`status ${statusClass(p.status)}`} style={{ marginTop: '10px', display: 'inline-block' }}>{p.status}</span>
            </div>

            {isConverted && (
              <div style={{
                background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px',
                padding: '10px 12px', marginBottom: '14px', fontSize: '0.82rem', color: '#065f46',
              }}>
                Employer sent <strong>${p.usd_value?.toFixed(2)}</strong> → worker received{' '}
                <strong>{fmtAmt(p.amount)} {p.currency}</strong>
                <span style={{ color: '#16a34a' }}> @ {p.fx_rate?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {p.currency}/USD · via Stellar DEX</span>
              </div>
            )}

            {p.failure_reason && (
              <div className="error-banner" style={{ marginBottom: '14px', fontSize: '0.82rem' }}>{p.failure_reason}</div>
            )}

            <Row label="From">{formatCompanyLabel(p.company_name, p.enterprise_email ?? p.enterprise_id.slice(0, 8))}</Row>
            <Row label="To">{p.worker_email ?? p.worker_id.slice(0, 8)}</Row>
            {p.stellar_destination && (
              <Row label="Worker address">
                <a href={`https://stellar.expert/explorer/testnet/account/${p.stellar_destination}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                  {p.stellar_destination.slice(0, 6)}…{p.stellar_destination.slice(-6)}
                </a>
              </Row>
            )}
            {p.memo && <Row label="Memo">{p.memo}</Row>}
            {p.fee_paid_xlm && <Row label="Conversion cost">{fmtAmt(p.fee_paid_xlm)} XLM</Row>}
            <Row label="Created">{fmtDate(p.created_at)}</Row>
            {p.completed_at && <Row label="Completed">{fmtDate(p.completed_at)}</Row>}
            {p.batch_id && <Row label="Batch">#{p.batch_id.slice(0, 8)}</Row>}
            <Row label="Payment ID">
              <span style={{ fontFamily: 'monospace', fontSize: '0.76rem' }}>{p.id.slice(0, 8)}…</span>
              <button onClick={() => copy(p.id, 'id')} title="Copy" style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', verticalAlign: 'middle' }}>
                {copied === 'id' ? <HiCheck size={14} /> : <HiOutlineClipboard size={14} />}
              </button>
            </Row>

            {p.stellar_tx_hash && (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`}
                  target="_blank" rel="noopener noreferrer"
                  className="btn-primary"
                  style={{ gap: '6px', textDecoration: 'none' }}
                >
                  View on Stellar Explorer <HiOutlineArrowTopRightOnSquare size={15} />
                </a>
                <button onClick={() => copy(p.stellar_tx_hash!, 'tx')} className="btn-secondary">
                  {copied === 'tx' ? 'Copied ✓' : 'Copy tx hash'}
                </button>
              </div>
            )}

            {p.status === 'completed' && (
              <div style={{ marginTop: '8px' }}>
                <button
                  onClick={() => generatePayslip({
                    id: p.id,
                    workerEmail: p.worker_email ?? p.worker_id,
                    enterpriseEmail: p.enterprise_email ?? p.enterprise_id.slice(0, 8),
                    companyName: p.company_name,
                    amount: p.amount,
                    currency: p.currency,
                    usdValue: p.usd_value,
                    fxRate: p.fx_rate,
                    stellarTxHash: p.stellar_tx_hash,
                    stellarDestination: p.stellar_destination,
                    feePaidXlm: p.fee_paid_xlm,
                    memo: p.memo,
                    createdAt: p.created_at,
                    completedAt: p.completed_at,
                  })}
                  className="btn-secondary"
                  style={{ gap: '6px', width: '100%' }}
                >
                  <HiOutlineArrowDownTray size={15} /> Download Payslip
                </button>
              </div>
            )}

            {p.status === 'failed' && (
              <div style={{ marginTop: '16px' }}>
                {retryError && (
                  <p style={{ color: '#dc2626', fontSize: '0.82rem', marginBottom: '8px' }}>{retryError}</p>
                )}
                {retrySuccess && (
                  <p style={{ color: '#16a34a', fontSize: '0.82rem', marginBottom: '8px' }}>Payment retried — reloading…</p>
                )}
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  className="btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#f59e0b', border: 'none' }}
                >
                  <HiOutlineArrowPath size={15} style={{ animation: retrying ? 'spin 1s linear infinite' : undefined }} />
                  {retrying ? 'Retrying…' : 'Retry Payment'}
                </button>
              </div>
            )}
          </div>
        ) : null}
    </SlideOver>
  );
}
