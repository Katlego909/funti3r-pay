import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import type { WalletCashout } from '../api/escrows.js';
import { StatusBadge } from './StatusBadge.js';
import CopyButton from './CopyButton.js';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';

const EXPLORER = 'https://stellar.expert/explorer/testnet';
const NOT_YET = <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Not yet</span>;

const STATUS: Record<WalletCashout['status'], ['completed' | 'failed' | 'pending', string]> = {
  pending: ['pending', 'In progress'],
  completed: ['completed', 'Paid out via MoneyGram'],
  failed: ['failed', 'Failed'],
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Every MoneyGram cash-out from the worker's wallet: what it cost, what the recipient
 * collects and the reference they quote at the pickup location. On the sandbox no
 * cash is dispensed, and the table says so.
 */
export default function CashoutsTable({ cashouts }: { cashouts: WalletCashout[] }) {
  const dc = useDisplayCurrency();
  if (!cashouts.length) return null;

  return (
    <section className="section">
      <h3>Cash-outs</h3>
      {cashouts.some((c) => c.sandbox) && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
          padding: '10px 12px', marginBottom: 10, fontSize: '0.8rem', color: '#92400e',
        }}>
          <strong>MoneyGram sandbox.</strong> The reference number is a real MoneyGram test reference, but no cash is
          dispensed. On the live service the recipient quotes it at the pickup location to collect the money.
        </div>
      )}
      <div className="table-responsive">
        <table className="data-table" style={{ whiteSpace: 'nowrap' }}>
          <thead>
            <tr><th>Date</th><th>Cost to you</th><th>Pickup</th><th>Reference</th><th>Recipient gets</th><th>Fee</th><th>Status</th></tr>
          </thead>
          <tbody>
            {cashouts.map((c) => {
              const [variant, label] = STATUS[c.status];
              return (
                <tr key={c.id}>
                  <td data-label="Date">{fmtDate(c.createdAt)}</td>
                  <td data-label="Cost to you">
                    {c.xlmSpent != null ? dc.format(c.xlmSpent, 'XLM') : NOT_YET}
                    {c.sendUsdc && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{dc.format(Number(c.sendUsdc), 'USDC')} sent</div>}
                  </td>
                  <td data-label="Pickup">
                    <div>Cash pickup</div>
                    {c.destinationCountry && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Country {c.destinationCountry}</div>}
                  </td>
                  <td data-label="Reference">
                    {c.referenceNumber ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'monospace', fontWeight: 600 }}>
                        {c.referenceNumber}
                        <CopyButton text={c.referenceNumber} />
                      </span>
                    ) : NOT_YET}
                  </td>
                  <td data-label="Recipient gets">
                    {c.receiveAmount ? `${c.receiveAmount}${c.receiveCurrency ? ` ${c.receiveCurrency}` : ''}` : NOT_YET}
                  </td>
                  <td data-label="Fee">{c.fee ? dc.format(Number(c.fee), c.feeCurrency ?? 'USDC') : NOT_YET}</td>
                  <td data-label="Status">
                    <StatusBadge variant={variant} title={c.error ?? undefined}>{label}</StatusBadge>
                    {c.settlementHash && (
                      <div style={{ fontSize: '0.75rem', marginTop: 4 }}>
                        <a
                          href={`${EXPLORER}/tx/${c.settlementHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--primary)', textDecoration: 'none' }}
                        >
                          USDC payment <HiOutlineArrowTopRightOnSquare size={12} />
                        </a>
                      </div>
                    )}
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
    </section>
  );
}
