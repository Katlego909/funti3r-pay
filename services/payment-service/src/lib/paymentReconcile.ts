/**
 * Chain check for ordinary payouts, in both directions.
 *
 * Paid → on chain: every payment the database says moved money must match a successful Stellar transaction that
 * carries that payment's own tag (Memo.hash(sha256(paymentId)), set by executePayout). Escrow rows (rail 'escrow')
 * are bookkeeping copies of a contract claim, which carries no memo: for those the transaction must exist and have
 * succeeded, and lib/escrowReconcile.ts checks them against the contract itself. A payment that passes is stamped
 * chain_verified_at and not checked again; one that fails stays unverified and is re-checked (and re-alerted) every run.
 *
 * Failed → not on chain: a payment recorded as failed whose stored transaction (written before submission) succeeded
 * after all is the dangerous direction, since a same-key retry would pay the worker twice.
 *
 * This never repairs anything. A discrepancy is a lost write, a wrong hash or a bug, and a person should look before
 * anything changes. It is logged and counted in payments_unverified_on_chain, which fires an alert. A Horizon error
 * skips that payment until the next run.
 */
import crypto from 'node:crypto';
import { query } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';
import { lookupTransaction } from './stellar.js';
import { unverifiedPayments } from './metrics.js';

const logger = createLogger('PaymentReconcile');

/** Settled payments older than this were verified while they were recent (or alerted on then). */
const SETTLED_WINDOW_DAYS = 7;
/** Horizon ingests a ledger a few seconds after it closes; a payment settled moments ago may not be listed yet. */
const SETTLED_MIN_AGE_MINUTES = 2;
const FAILED_WINDOW_HOURS = 72;
const MAX_PER_RUN = 500;

export interface PaymentDiscrepancy {
  paymentId: string;
  reason:
    | 'no transaction recorded'
    | 'transaction not on chain'
    | 'transaction failed on chain'
    | 'transaction belongs to another payment'
    | 'recorded as failed but its transaction succeeded';
  txHash: string | null;
}

export async function verifyRecentPayments(): Promise<PaymentDiscrepancy[]> {
  const found: PaymentDiscrepancy[] = [];
  const verified: string[] = [];

  const settled = await query(
    `SELECT id, stellar_tx_hash, rail FROM payments
      WHERE status IN ('completed', 'pending_claim') AND chain_verified_at IS NULL
        AND updated_at > NOW() - INTERVAL '${SETTLED_WINDOW_DAYS} days'
        AND updated_at < NOW() - INTERVAL '${SETTLED_MIN_AGE_MINUTES} minutes'
      ORDER BY updated_at LIMIT ${MAX_PER_RUN}`,
  ) as { rows: Array<{ id: string; stellar_tx_hash: string | null; rail: string | null }> };

  for (const p of settled.rows) {
    if (!p.stellar_tx_hash) {
      found.push({ paymentId: p.id, reason: 'no transaction recorded', txHash: null });
      continue;
    }
    let tx: Awaited<ReturnType<typeof lookupTransaction>>;
    try {
      tx = await lookupTransaction(p.stellar_tx_hash);
    } catch (err) {
      logger.warn('Could not check a payment on chain; will retry next run', { paymentId: p.id, error: String(err) });
      continue;
    }
    const expectedMemo = crypto.createHash('sha256').update(p.id).digest('base64');
    if (!tx.found) found.push({ paymentId: p.id, reason: 'transaction not on chain', txHash: p.stellar_tx_hash });
    else if (!tx.successful) found.push({ paymentId: p.id, reason: 'transaction failed on chain', txHash: p.stellar_tx_hash });
    else if (p.rail !== 'escrow' && (tx.memoType !== 'hash' || tx.memo !== expectedMemo)) {
      found.push({ paymentId: p.id, reason: 'transaction belongs to another payment', txHash: p.stellar_tx_hash });
    } else verified.push(p.id);
  }

  if (verified.length) {
    await query(`UPDATE payments SET chain_verified_at = NOW() WHERE id = ANY($1::uuid[])`, [verified]);
  }

  const failed = await query(
    `SELECT id, stellar_tx_hash FROM payments
      WHERE status = 'failed' AND stellar_tx_hash IS NOT NULL AND updated_at > NOW() - INTERVAL '${FAILED_WINDOW_HOURS} hours'
      ORDER BY updated_at DESC LIMIT ${MAX_PER_RUN}`,
  ) as { rows: Array<{ id: string; stellar_tx_hash: string }> };

  for (const p of failed.rows) {
    try {
      const tx = await lookupTransaction(p.stellar_tx_hash);
      if (tx.found && tx.successful) {
        found.push({ paymentId: p.id, reason: 'recorded as failed but its transaction succeeded', txHash: p.stellar_tx_hash });
      }
    } catch (err) {
      logger.warn('Could not check a failed payment on chain; will retry next run', { paymentId: p.id, error: String(err) });
    }
  }

  unverifiedPayments.set(found.length);
  for (const d of found) logger.error('Payment record disagrees with the chain', { ...d });
  return found;
}
