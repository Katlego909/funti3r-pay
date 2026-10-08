import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import type { WalletCashout } from '../api/escrows.js';
import { StatusBadge } from './StatusBadge.js';
import CopyButton from './CopyButton.js';

const EXPLORER = 'https://stellar.expert/explorer/testnet';
const NOT_YET = <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Not yet</span>;

const STATUS: Record<WalletCashout['status'], ['completed' | 'failed' | 'pending', string]> = {
  pending: ['pending', 'In progress'],
  completed: ['completed', 'Paid out via MoneyGram'],
  failed: ['failed', 'Failed'],
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const num = (v: string | number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Every MoneyGram cash-out from the worker's wallet, in the order it happens: what left
 * the wallet, what MoneyGram was sent, what the recipient collects and the reference they
 * quote at the pickup location. Each step is shown in its own asset, because on testnet
 * the swap between them does not follow real prices. On the sandbox no cash is dispensed.
 */
export default function CashoutsTable({ cashouts }: { cashouts: WalletCashout[] }) {
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
          Testnet also trades XLM for USDC at about 1:1 (the real market is about 5:1), so these cash-outs pay out far
          more than the same XLM would on the live network.
        </div>
      )}
      <div className="table-responsive">
        <table className="data-table" style={{ whiteSpace: 'nowrap' }}>
          <thead>
            <tr><th>Date</th><th>You withdrew</th><th>Pickup</th><th>Reference</th><th>Recipient collects</th><th>Status</th></tr>
          </thead>
          <tbody>
            {cashouts.map((c) => {
              const [variant, label] = STATUS[c.status];
              return (
                <tr key={c.id}>
                  <td data-label="Date">{fmtDate(c.createdAt)}</td>
                  <td data-label="You withdrew">
                    {c.sendUsdc ? `${num(c.sendUsdc)} USDC` : NOT_YET}
                    {c.xlmSpent != null && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>paid with {num(c.xlmSpent)} XLM</div>}
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
                  <td data-label="Recipient collects">
                    {c.receiveAmount ? `${num(c.receiveAmount)}${c.receiveCurrency ? ` ${c.receiveCurrency}` : ''}` : NOT_YET}
                    {c.fee && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>after {num(c.fee)} {c.feeCurrency ?? 'USDC'} fee</div>}
                  </td>
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
