import { useState } from 'react';
import type { WalletCashout } from '../api/escrows.js';
import { StatusBadge } from './StatusBadge.js';
import CopyButton from './CopyButton.js';
import CashoutReceiptDrawer from './CashoutReceiptDrawer.js';

const NOT_YET = <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Not yet</span>;

const STATUS: Record<WalletCashout['status'], ['completed' | 'failed' | 'pending', string]> = {
  pending: ['pending', 'In progress'],
  completed: ['completed', 'Paid out via MoneyGram'],
  failed: ['failed', 'Failed'],
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const num = (v: string | number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Every MoneyGram cash-out from the worker's wallet: what the recipient collects and the
 * reference they quote at the pickup location. Select a row for the step-by-step receipt.
 */
export default function CashoutsTable({ cashouts }: { cashouts: WalletCashout[] }) {
  const [open, setOpen] = useState<WalletCashout | null>(null);
  if (!cashouts.length) return null;

  return (
    <section className="section">
      <h3>Cash-outs</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--gray-600)', marginTop: '-6px', marginBottom: 16 }}>
        Select a cash-out to see how the amount was worked out.
      </p>
      {cashouts.some((c) => c.sandbox) && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
          padding: '10px 12px', marginBottom: 16, fontSize: '0.8rem', color: '#92400e',
        }}>
          <strong>MoneyGram sandbox.</strong> These references are real MoneyGram test references, but no cash is dispensed.
        </div>
      )}
      <div className="table-responsive">
        <table className="data-table" style={{ whiteSpace: 'nowrap' }}>
          <thead>
            <tr><th>Date</th><th>Recipient collects</th><th>Pickup reference</th><th>Status</th></tr>
          </thead>
          <tbody>
            {cashouts.map((c) => {
              const [variant, label] = STATUS[c.status];
              return (
                <tr key={c.id} onClick={() => setOpen(c)} style={{ cursor: 'pointer' }}>
                  <td data-label="Date">{fmtDate(c.createdAt)}</td>
                  <td data-label="Recipient collects" style={{ fontWeight: 600 }}>
                    {c.receiveAmount ? `${num(c.receiveAmount)}${c.receiveCurrency ? ` ${c.receiveCurrency}` : ''}` : NOT_YET}
                    {c.destinationCountry && <div style={{ fontSize: '0.75rem', fontWeight: 400, color: '#6b7280' }}>Cash pickup · {c.destinationCountry}</div>}
                  </td>
                  <td data-label="Pickup reference" onClick={(e) => e.stopPropagation()}>
                    {c.referenceNumber ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'monospace', fontWeight: 600 }}>
                        {c.referenceNumber}
                        <CopyButton text={c.referenceNumber} />
                      </span>
                    ) : NOT_YET}
                  </td>
                  <td data-label="Status">
                    <StatusBadge variant={variant} title={c.error ?? undefined}>{label}</StatusBadge>
                    {c.status === 'failed' && c.error && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--gray-600)', marginTop: 4 }}>{c.error}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CashoutReceiptDrawer cashout={open} onClose={() => setOpen(null)} />
    </section>
  );
}
