import type { Escrow } from '../api/escrows.js';
import { StatusBadge } from './StatusBadge.js';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';

const DASH = <span style={{ color: '#9ca3af' }}>—</span>;

/**
 * Where each milestone's money is right now: locked in the contract, released to the
 * worker's wallet, spent on a cash-out, or still in the wallet. Every amount is in the
 * viewer's display currency so it reads as one number, not a list of assets.
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
            <th>Cashed out</th>
            <th>{you ? 'Still in your wallet' : 'Left in worker\'s wallet'}</th>
          </tr>
        </thead>
        <tbody>
          {escrow.milestones.map((m) => {
            const locked = m.status === 'pending' || m.status === 'approved';
            const spent = m.cashoutStatus === 'completed' ? (m.cashoutXlmSpent ?? 0) : 0;
            const left = m.status === 'claimed' ? Math.max(0, m.amountXlm - spent) : null;
            const [variant, where]: ['completed' | 'failed' | 'pending', string] =
              locked ? ['pending', 'Locked in escrow']
              : m.status === 'refunded' ? ['failed', you ? 'Refunded to employer' : 'Refunded to you']
              : [ 'completed', you ? 'Released to your wallet' : 'Released to worker'];
            return (
              <tr key={m.idx}>
                <td data-label="Milestone" style={{ fontWeight: 600 }}>{m.description || `Milestone ${m.idx + 1}`}</td>
                <td data-label="Amount">{dc.format(m.amountXlm, 'XLM')}</td>
                <td data-label="Where it is"><StatusBadge variant={variant}>{where}</StatusBadge></td>
                <td data-label="Cashed out">
                  {m.cashoutStatus === 'completed' && m.cashoutXlmSpent != null ? dc.format(m.cashoutXlmSpent, 'XLM') : DASH}
                </td>
                <td data-label={you ? 'Still in your wallet' : 'Left in worker\'s wallet'}>
                  {left !== null ? dc.format(left, 'XLM') : DASH}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
