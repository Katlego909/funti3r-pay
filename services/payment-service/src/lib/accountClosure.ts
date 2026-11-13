import { query } from '@funti3r/database';
import { balancesHeld } from './stellar.js';

/**
 * Why this user's account cannot be closed yet, as sentences to show them. Empty means nothing stops it.
 *
 * Closing destroys the account's custodial key (user-service POST /users/me/close), so anything still held, owed or
 * on its way would be lost: money in the wallet, open escrows, payments or cash-outs not yet settled, and payroll
 * schedules that would keep paying. Company-wide rows are keyed by the owner's user id, so a teammate who closes
 * their own account is not blocked by their company's escrows or schedules, only the owner is.
 */
export async function closureBlockers(userId: string): Promise<string[]> {
  const blockers: string[] = [];

  const user = (await query('SELECT stellar_public_key FROM users WHERE id = $1', [userId])).rows[0];
  if (user?.stellar_public_key) {
    for (const { asset, amount } of await balancesHeld(user.stellar_public_key)) {
      blockers.push(`Your wallet still holds ${amount} ${asset}. Cash it out or send it before closing.`);
    }
  }

  const counts = (await query(
    `SELECT
       (SELECT COUNT(*) FROM escrows WHERE (worker_id = $1 OR enterprise_id = $1) AND status = 'active') AS escrows,
       (SELECT COUNT(*) FROM payments WHERE (worker_id = $1 OR enterprise_id = $1)
          AND status IN ('initiated', 'pending_signature', 'submitted', 'pending_claim')) AS payments,
       (SELECT COUNT(*) FROM cashouts WHERE worker_id = $1 AND status = 'pending') AS cashouts,
       (SELECT COUNT(*) FROM payment_schedules WHERE enterprise_id = $1 AND status = 'active') AS schedules`,
    [userId],
  )).rows[0] ?? {};

  const n = (v: unknown) => Number(v ?? 0);
  if (n(counts.escrows) > 0) blockers.push(`${n(counts.escrows)} escrow(s) are still active. Wait for them to complete or be refunded.`);
  if (n(counts.payments) > 0) blockers.push(`${n(counts.payments)} payment(s) have not settled yet.`);
  if (n(counts.cashouts) > 0) blockers.push(`${n(counts.cashouts)} cash-out(s) are still in progress.`);
  if (n(counts.schedules) > 0) blockers.push(`${n(counts.schedules)} payroll schedule(s) are active. Pause or delete them first.`);
  return blockers;
}
