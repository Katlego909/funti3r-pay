import type { Escrow } from '../api/escrows.js';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';

const NOT_RECORDED = <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Not recorded</span>;

const money = (amount: string | null, asset: string | null) =>
  amount ? `${amount}${asset ? ` ${asset}` : ''}` : null;

/**
 * Where each anchor cash-out went: who it was addressed to, which account, and
 * what the anchor said it pays out. On the SDF test anchor nothing real moves,
 * and the panel says so rather than letting "Paid out" imply a bank deposit.
 */
export default function EscrowPayouts({ escrow }: { escrow: Escrow }) {
  const dc = useDisplayCurrency();
  const paid = escrow.milestones.filter((m) => m.payout);
  if (!paid.length) {
    return <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>No anchor payouts yet.</p>;
  }
  const sandbox = paid.some((m) => m.payout?.sandbox);

  return (
    <div>
      {sandbox && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
          padding: '10px 12px', marginBottom: 10, fontSize: '0.8rem', color: '#92400e',
        }}>
          <strong>Test anchor.</strong> This payout went to the Stellar test anchor on testnet, which moves no real
          money — the bank details below are test data and nothing arrives in a bank account. On a live anchor, this is
          the amount it sends to the account shown.
        </div>
      )}
      <div className="table-responsive">
        <table className="data-table" style={{ whiteSpace: 'nowrap' }}>
          <thead>
            <tr><th>Milestone</th><th>Paid to</th><th>Account</th><th>Recipient gets</th><th>Fee</th></tr>
          </thead>
          <tbody>
            {paid.map((m) => {
              const p = m.payout!;
              const d = p.destination;
              return (
                <tr key={m.idx}>
                  <td data-label="Milestone" style={{ fontWeight: 600 }}>
                    {m.description || `Milestone ${m.idx + 1}`}
                    <div style={{ fontSize: '0.75rem', fontWeight: 400, color: '#6b7280' }}>
                      {dc.format(m.amountXlm, 'XLM')} sent
                    </div>
                  </td>
                  <td data-label="Paid to">
                    {d?.name ? (
                      <>
                        <div>{d.name}</div>
                        {d.email && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{d.email}</div>}
                      </>
                    ) : NOT_RECORDED}
                  </td>
                  <td data-label="Account">
                    {d?.accountLast4 ? (
                      <>
                        <div style={{ fontFamily: 'monospace' }}>••••{d.accountLast4}</div>
                        {d.bankNumber && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Bank {d.bankNumber}</div>}
                      </>
                    ) : NOT_RECORDED}
                  </td>
                  <td data-label="Recipient gets">{money(p.receivedAmount, p.receivedAsset) ?? NOT_RECORDED}</td>
                  <td data-label="Fee">{p.fee ? dc.format(Number(p.fee), p.feeAsset ?? 'USDC') : NOT_RECORDED}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
