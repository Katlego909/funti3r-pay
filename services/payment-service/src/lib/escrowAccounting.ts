/**
 * Escrow money in the books.
 *
 * `payments` is what Total Received, Payment History, the charts and the
 * employer's totals read. A claimed milestone is the moment a worker actually
 * receives escrow money, so it is recorded there as one completed payment
 * (funding is "locked", cash-outs are the worker spending their own money, and
 * refunds are the employer getting theirs back — none of those are payments).
 *
 * Idempotent: keyed `escrow:<escrowId>:<idx>` on the unique
 * (enterprise_id, idempotency_key) index, so the claim route, the reconciler and
 * the backfill in migration 019 can all call it for the same milestone safely.
 */
import { query } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('EscrowAccounting');

/** Records the milestone's claim as a completed payment. Returns true when a row was added. */
export async function recordEscrowPayment(escrowId: string, idx: number): Promise<boolean> {
  const r = await query(
    `INSERT INTO payments
       (enterprise_id, worker_id, amount, currency, status, stellar_tx_hash, stellar_destination,
        description, reference_id, created_at, completed_at, updated_at, idempotency_key, rail)
     SELECT e.enterprise_id, e.worker_id, m.amount, 'XLM', 'completed', m.claim_tx_hash, u.stellar_public_key,
            'Escrow milestone: ' || COALESCE(NULLIF(m.description, ''), 'Milestone ' || (m.idx + 1)),
            e.id::text, COALESCE(m.claimed_at, NOW()), COALESCE(m.claimed_at, NOW()), COALESCE(m.claimed_at, NOW()),
            'escrow:' || e.id::text || ':' || m.idx, 'escrow'
       FROM escrow_milestones m
       JOIN escrows e ON e.id = m.escrow_id
       JOIN users u ON u.id = e.worker_id
      WHERE e.id = $1 AND m.idx = $2 AND m.status = 'claimed'
     ON CONFLICT (enterprise_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [escrowId, idx],
  );
  return r.rows.length > 0;
}

/**
 * Same, for callers where the money has already moved on-chain: an accounting
 * hiccup must never turn a real claim into an error. The reconciler retries it.
 */
export async function recordEscrowPaymentSafely(escrowId: string, idx: number): Promise<void> {
  try {
    await recordEscrowPayment(escrowId, idx);
  } catch (err) {
    logger.warn('Could not record escrow payment (will be retried by the reconciler)', {
      escrowId, idx, error: String(err),
    });
  }
}

/** Scheduled sweep: records any claimed milestone that has no payment row yet. */
export async function recordAllMissingEscrowPayments(): Promise<number> {
  const r = await query(
    `INSERT INTO payments
       (enterprise_id, worker_id, amount, currency, status, stellar_tx_hash, stellar_destination,
        description, reference_id, created_at, completed_at, updated_at, idempotency_key, rail)
     SELECT e.enterprise_id, e.worker_id, m.amount, 'XLM', 'completed', m.claim_tx_hash, u.stellar_public_key,
            'Escrow milestone: ' || COALESCE(NULLIF(m.description, ''), 'Milestone ' || (m.idx + 1)),
            e.id::text, COALESCE(m.claimed_at, NOW()), COALESCE(m.claimed_at, NOW()), COALESCE(m.claimed_at, NOW()),
            'escrow:' || e.id::text || ':' || m.idx, 'escrow'
       FROM escrow_milestones m
       JOIN escrows e ON e.id = m.escrow_id
       JOIN users u ON u.id = e.worker_id
      WHERE m.status = 'claimed'
     ON CONFLICT (enterprise_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING id`,
  );
  if (r.rows.length) logger.info('Recorded missing escrow payments', { count: r.rows.length });
  return r.rows.length;
}
