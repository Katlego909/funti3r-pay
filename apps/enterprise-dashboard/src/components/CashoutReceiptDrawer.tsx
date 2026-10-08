import { useRef } from 'react';
import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import type { WalletCashout } from '../api/escrows.js';
import SlideOver, { Row, SectionTitle } from './SlideOver.js';
import { StatusBadge } from './StatusBadge.js';
import CopyButton from './CopyButton.js';
import { buildReceipt } from '../lib/cashoutReceipt.js';

const EXPLORER = 'https://stellar.expert/explorer/testnet';

const STATUS: Record<WalletCashout['status'], ['completed' | 'failed' | 'pending', string]> = {
  pending: ['pending', 'In progress'],
  completed: ['completed', 'Paid out via MoneyGram'],
  failed: ['failed', 'Failed'],
};

const amount = (v: number, digits = 2) => v.toLocaleString(undefined, { maximumFractionDigits: digits });

interface Step { title: string; detail?: string; note?: string; value: string; strong?: boolean }

/** One cash-out explained step by step, in plain words, like an off-ramp receipt. */
export default function CashoutReceiptDrawer({ cashout, onClose }: { cashout: WalletCashout | null; onClose: () => void }) {
  // Keep the last cash-out so content stays put while the panel slides out.
  const last = useRef<WalletCashout | null>(null);
  if (cashout) last.current = cashout;
  const c = cashout ?? last.current;

  return (
    <SlideOver openKey={cashout} title="Cash-out receipt" width={560} onClose={onClose}>
      {c && <Receipt c={c} />}
    </SlideOver>
  );
}

function Receipt({ c }: { c: WalletCashout }) {
  const r = buildReceipt(c);
  const [variant, label] = STATUS[c.status];
  const currency = r.receiveCurrency ?? '';

  const steps: Step[] = [];
  if (r.xlmSold !== null) {
    steps.push({ title: 'You cashed out', detail: 'Taken from your wallet balance', value: `${amount(r.xlmSold)} XLM` });
  }
  if (r.usdcSent !== null) {
    steps.push({
      title: r.xlmSold !== null ? 'Swapped to US dollars' : 'Sent to MoneyGram',
      detail: r.swapRate !== null ? `1 XLM = ${amount(r.swapRate, 4)} USDC on the Stellar exchange` : 'US dollars (USDC), paid to MoneyGram',
      note: r.swapRate !== null && c.sandbox
        ? 'On the test network XLM and USDC trade at about 1:1, so this rate is far better than the live market.'
        : undefined,
      value: `${amount(r.usdcSent)} USDC`,
    });
  }
  if (r.feeUsdc !== null && r.usdcConverted !== null) {
    steps.push({ title: 'MoneyGram fee', detail: `${amount(r.usdcConverted)} USDC left to convert`, value: `− ${amount(r.feeUsdc)} USDC` });
  }
  if (r.receiveAmount !== null) {
    steps.push({
      title: currency ? `Converted to ${currency}` : 'Converted for pickup',
      detail: r.fxRate !== null && currency ? `1 USDC = ${amount(r.fxRate, 4)} ${currency}` : undefined,
      value: `${amount(r.receiveAmount)} ${currency}`.trim(),
      strong: true,
    });
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16, textAlign: 'center' }}>
        <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Recipient collects</div>
        <div style={{ fontSize: '1.9rem', fontWeight: 800 }}>
          {r.receiveAmount !== null ? `${amount(r.receiveAmount)} ${currency}` : 'Waiting for MoneyGram'}
        </div>
        <StatusBadge variant={variant} style={{ marginTop: 10, display: 'inline-block' }}>{label}</StatusBadge>
      </div>

      {c.referenceNumber ? (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>Pickup reference</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '1.4rem', fontWeight: 700, letterSpacing: 1 }}>{c.referenceNumber}</span>
            <CopyButton text={c.referenceNumber} title="Copy reference" />
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
            Give this number at the MoneyGram location to collect the cash.
            {c.sandbox && ' This is the sandbox, so no cash is dispensed.'}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>MoneyGram has not issued the pickup reference yet. It appears here as soon as it does.</p>
      )}

      {steps.length > 0 && (
        <>
          <SectionTitle>How it was calculated</SectionTitle>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {steps.map((s, i) => (
              <li key={s.title} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 12, padding: '10px 0', borderTop: i ? '1px solid #f1f5f9' : undefined }}>
                <span style={{
                  width: 24, height: 24, borderRadius: '50%', background: s.strong ? 'var(--gray-900)' : '#e5e7eb',
                  color: s.strong ? '#fff' : '#374151', fontSize: '0.75rem', fontWeight: 700, display: 'grid', placeItems: 'center',
                }}>{i + 1}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.title}</div>
                  {s.detail && <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{s.detail}</div>}
                  {s.note && <div style={{ fontSize: '0.75rem', color: '#92400e', marginTop: 4 }}>{s.note}</div>}
                </div>
                <div style={{ fontWeight: s.strong ? 800 : 600, whiteSpace: 'nowrap' }}>{s.value}</div>
              </li>
            ))}
          </ol>
        </>
      )}

      <SectionTitle>Details</SectionTitle>
      <Row label="Date">{new Date(c.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</Row>
      {c.destinationCountry && <Row label="Pickup country">{c.destinationCountry}</Row>}
      {c.mgStatus && <Row label="MoneyGram status"><span style={{ textTransform: 'capitalize' }}>{c.mgStatus.replace(/_/g, ' ')}</span></Row>}
      {c.settlementHash && (
        <Row label="Stellar payment">
          <a
            href={`${EXPLORER}/tx/${c.settlementHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: 'monospace', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            {c.settlementHash.slice(0, 8)}…{c.settlementHash.slice(-6)} <HiOutlineArrowTopRightOnSquare size={12} />
          </a>
          <CopyButton text={c.settlementHash} style={{ marginLeft: 6, verticalAlign: 'middle' }} />
        </Row>
      )}
      {c.status === 'failed' && c.error && <Row label="Reason">{c.error}</Row>}
    </div>
  );
}
