import type { Escrow } from '../api/escrows.js';

const NOT_RECORDED = <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Not recorded</span>;

const money = (amount: string | null, asset: string | null) =>
  amount ? `${amount}${asset ? ` ${asset}` : ''}` : null;

/**
 * Where each anchor cash-out went: who it was addressed to, which account, and
 * what the anchor said it pays out. On the SDF test anchor nothing real moves,
 * and the panel says so rather than letting "Paid out" imply a bank deposit.
 */
export default function EscrowPayouts({ escrow }: { escrow: Escrow }) {
  const paid = escrow.milestones.filter((m) => m.payout);
  if (!paid.length) {
    return <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>No anchor payouts yet.</p>;
  }
  const sandbox = paid.some((m) => m.payout?.sandbox && m.payout.rail !== 'moneygram');
  const mgSandbox = paid.some((m) => m.payout?.sandbox && m.payout.rail === 'moneygram');

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
      {mgSandbox && (
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
            <tr><th>Milestone</th><th>Paid to</th><th>Account / reference</th><th>Recipient gets</th><th>Fee</th></tr>
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
                      {p.rail === 'moneygram' ? `${m.amountXlm} XLM milestone` : `${m.amountXlm} XLM sent`}
                    </div>
                  </td>
                  <td data-label="Paid to">
                    {p.rail === 'moneygram' ? (
                      <>
                        <div>Cash pickup</div>
                        {p.destinationCountry && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Country {p.destinationCountry}</div>}
                      </>
                    ) : d?.name ? (
                      <>
                        <div>{d.name}</div>
                        {d.email && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{d.email}</div>}
                      </>
                    ) : NOT_RECORDED}
                  </td>
                  <td data-label="Account / reference">
                    {p.rail === 'moneygram' ? (
                      p.referenceNumber ? (
                        <>
                          <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>Ref {p.referenceNumber}</div>
                          {p.sendUsdc && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{p.sendUsdc} USDC sent</div>}
                        </>
                      ) : <span style={{ color: '#9ca3af', fontSize: '0.78rem' }}>Reference pending</span>
                    ) : d?.accountLast4 ? (
                      <>
                        <div style={{ fontFamily: 'monospace' }}>••••{d.accountLast4}</div>
                        {d.bankNumber && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Bank {d.bankNumber}</div>}
                      </>
                    ) : NOT_RECORDED}
                  </td>
                  <td data-label="Recipient gets">{money(p.receivedAmount, p.receivedAsset) ?? NOT_RECORDED}</td>
                  <td data-label="Fee">{money(p.fee, p.feeAsset) ?? NOT_RECORDED}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
