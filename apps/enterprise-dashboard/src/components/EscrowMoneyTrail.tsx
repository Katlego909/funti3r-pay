import type { Escrow } from '../api/escrows.js';
import { StatusBadge } from './StatusBadge.js';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';

/**
 * Where each milestone's money is right now: locked in the contract, released to the
 * worker's wallet, or refunded. What the worker later cashes out of the wallet is a
 * wallet-level cash-out, listed on the Wallet page. Amounts are in the viewer's display currency.
 */
export default function EscrowMoneyTrail({ escrow, viewer }: { escrow: Escrow; viewer: 'worker' | 'employer' }) {
  const dc = useDisplayCurrency();
  const you = viewer === 'worker';

  return (
    <div className="table-responsive">
      <table className="data-table" style={{ whiteSpace: 'nowrap' }}>
        <thead>
          <tr>
            <th>Milestone</th>
            <th>Amount</th>
            <th>Where it is</th>
          </tr>
        </thead>
        <tbody>
          {escrow.milestones.map((m) => {
            const locked = m.status === 'pending' || m.status === 'approved';
            const [variant, where]: ['completed' | 'failed' | 'pending', string] =
              locked ? ['pending', 'Locked in escrow']
              : m.status === 'refunded' ? ['failed', you ? 'Refunded to employer' : 'Refunded to you']
              : [ 'completed', you ? 'Released to your wallet' : 'Released to worker'];
            return (
              <tr key={m.idx}>
                <td data-label="Milestone" style={{ fontWeight: 600 }}>{m.description || `Milestone ${m.idx + 1}`}</td>
                <td data-label="Amount">{dc.format(m.amountXlm, 'XLM')}</td>
                <td data-label="Where it is"><StatusBadge variant={variant}>{where}</StatusBadge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
