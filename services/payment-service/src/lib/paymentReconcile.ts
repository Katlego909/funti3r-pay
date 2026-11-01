/**
 * Chain check for ordinary payouts: every payment the database says moved money must match a successful Stellar
 * transaction that carries that payment's own tag (Memo.hash(sha256(paymentId)), set by executePayout). Escrow rows
 * (rail 'escrow') are bookkeeping copies of a contract claim, which carries no memo: for those the transaction must
 * exist and have succeeded, and lib/escrowReconcile.ts checks them against the contract itself.
 *
 * Unlike the escrow reconciler this never repairs anything. A payment recorded as paid that the chain does not back
 * up is a money discrepancy (a lost write, a wrong hash, a bug), and a person should look before anything changes. It
 * is logged and counted in payments_unverified_on_chain, which fires an alert. A Horizon error skips that payment.
 */
import crypto from 'node:crypto';
import { query } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';
import { lookupTransaction } from './stellar.js';
import { unverifiedPayments } from './metrics.js';

const logger = createLogger('PaymentReconcile');

/** Payments settled within this window are re-checked each run; older ones were checked while they were recent. */
const WINDOW_HOURS = 24;
const MAX_PER_RUN = 500;

export interface PaymentDiscrepancy {
  paymentId: string;
  reason: 'no transaction recorded' | 'transaction not on chain' | 'transaction failed on chain' | 'transaction belongs to another payment';
  txHash: string | null;
}

export async function verifyRecentPayments(): Promise<PaymentDiscrepancy[]> {
  const { rows } = await query(
    `SELECT id, stellar_tx_hash, rail FROM payments
      WHERE status IN ('completed', 'pending_claim') AND updated_at > NOW() - INTERVAL '${WINDOW_HOURS} hours'
      ORDER BY updated_at DESC LIMIT ${MAX_PER_RUN}`,
  ) as { rows: Array<{ id: string; stellar_tx_hash: string | null; rail: string | null }> };

  const found: PaymentDiscrepancy[] = [];
  for (const p of rows) {
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
    }
  }

  unverifiedPayments.set(found.length);
  for (const d of found) logger.error('Payment recorded as paid is not backed by the chain', { ...d });
  return found;
}
