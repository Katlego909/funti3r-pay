/**
 * What a payment's status means for the money, in one place: every count, total and batch verdict derives from these,
 * so the live batch, its idempotent replay and the watchdog can never tell the same batch's story differently.
 */

/** The money left the employer: paid outright, or held as a claimable balance (pending_claim) the worker can take. */
export function isMoneyMoved(status: string): boolean {
  return status === 'completed' || status === 'pending_claim';
}

/** Sent to Stellar but without a verdict yet; the watchdog settles it from the chain (scheduler.ts). */
export function isAwaitingChain(status: string): boolean {
  return status === 'initiated' || status === 'submitted';
}

export type BatchStatus = 'processing' | 'completed' | 'partial' | 'failed';

/**
 * A batch's verdict from its payments' statuses. `expected` is how many payments the batch was meant to make: items a
 * crash kept from ever being recorded count as not paid. Payments still awaiting the chain keep the batch processing.
 */
export function batchVerdict(statuses: string[], expected = statuses.length): {
  status: BatchStatus; movedCount: number; failedCount: number; awaitingCount: number; pendingClaimCount: number;
} {
  const movedCount = statuses.filter(isMoneyMoved).length;
  const awaitingCount = statuses.filter(isAwaitingChain).length;
  const pendingClaimCount = statuses.filter((s) => s === 'pending_claim').length;
  const failedCount = expected - movedCount - awaitingCount;
  const status: BatchStatus = awaitingCount > 0 ? 'processing'
    : failedCount === 0 ? 'completed'
    : movedCount === 0 ? 'failed'
    : 'partial';
  return { status, movedCount, failedCount, awaitingCount, pendingClaimCount };
}
