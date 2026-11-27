import type { Row } from '../api';
import { money, short } from '../format';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * An audit event in words: what happened, the reason given (if any) and the transaction it produced (if any). Ids
 * are replaced by the emails the API joins in (actor, the account it was about, the worker paid). Anything this does
 * not know yet is still readable: the action becomes a sentence and its detail "key: value" pairs.
 */
export function describe(e: Row): { summary: string; reason?: string; txHash?: string } {
  const d: Row = e.detail ?? {};
  const who = e.worker_email ?? (d.workerId ? `worker ${short(d.workerId, 8)}` : 'the worker');
  const account = e.entity_email ?? 'the account';
  const summaries: Record<string, () => string> = {
    'payout.completed': () => `Paid ${money(d.amount, d.currency)} to ${who}`,
    'payout.pending_claim': () => `Sent ${money(d.amount, d.currency)} to ${who}, waiting for them to claim it`,
    'payout.submitted': () => `Sent ${money(d.amount, d.currency)} to ${who}, waiting for the network`,
    'payout.failed': () => `Payout of ${money(d.amount, d.currency)} to ${who} failed${d.error ? `: ${d.error}` : ''}`,
    'escrow.created': () => `Locked ${money(d.total, d.tokenCode ?? 'XLM')} in escrow for ${who}${d.milestones ? ` (${plural(d.milestones, 'milestone')})` : ''}`,
    'escrow.work_submitted': () => 'The worker submitted work for review',
    'escrow.work_rejected': () => 'Submitted work was sent back',
    'escrow.milestone_approved': () => 'Approved a milestone',
    'escrow.milestone_claimed': () => `The worker claimed ${money(d.amount, d.tokenCode ?? 'XLM')}`,
    'escrow.refunded': () => `Refunded ${money(d.refundedXlm ?? d.amount, d.tokenCode ?? 'XLM')} to the employer`,
    'escrow.frozen': () => 'Froze the escrow',
    'escrow.unfrozen': () => 'Lifted the hold on the escrow',
    'escrow.returned_frozen': () => `Returned ${money(d.returned, d.tokenCode)} of a frozen escrow to the employer`,
    'escrow.reconciled': () => `Brought escrows in line with the contract (${d.checked ?? '?'} checked, ${d.repaired ?? 0} repaired)`,
    'cashout.submitted': () => `Started a cash-out of ${money(d.usdc, 'USDC')}`,
    'cashout.paid': () => `Cashed out ${money(d.usdc, 'USDC')} through MoneyGram`,
    'cashout.payment_failed': () => `A cash-out payment failed${d.error ? `: ${d.error}` : ''}`,
    'account.suspended': () => `Suspended ${account}`,
    'account.reactivated': () => `Reactivated ${account}`,
    account_closed: () => `${account} was closed`,
    'admin.granted': () => `Made ${account} a platform admin${d.by ? ` (by ${d.by}, on the server)` : ''}`,
    'admin.revoked': () => `Removed ${account}'s admin access${d.by ? ` (by ${d.by}, on the server)` : ''}`,
    'kyc.revealed': () => `Revealed the full KYC record of ${account}`,
  };
  const known = summaries[e.action];
  const summary = known ? known() : fallback(e.action, d);
  return { summary, reason: d.reason, txHash: d.txHash };
}

/** An action nobody has described yet, still in words: "escrow.reconciled" → "Escrow reconciled", plus its detail. */
function fallback(action: string, d: Row): string {
  const words = action.replace(/[._]/g, ' ');
  const rest = Object.entries(d)
    .filter(([k]) => k !== 'reason' && k !== 'txHash')
    .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${typeof v === 'string' && v.length > 20 ? short(v) : String(v)}`)
    .join(', ');
  return `${words[0].toUpperCase()}${words.slice(1)}${rest ? ` (${rest})` : ''}`;
}
