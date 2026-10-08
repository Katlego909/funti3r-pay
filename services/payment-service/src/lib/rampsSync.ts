/**
 * Keeps a MoneyGram cash-out in step with MoneyGram's own record of it.
 *
 * After we send the USDC deposit, MoneyGram moves the transaction out of
 * `awaiting_funds`; its record then carries the cash-pickup reference number and
 * what the recipient receives. This copies that onto the milestone and completes
 * the cash-out once MoneyGram has acknowledged our payment.
 */
import { query } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';
import { getTransaction, listTransactions, moneygramConfigured, type RampsTransaction } from './moneygram.js';

const logger = createLogger('RampsSync');

/** MoneyGram has not (yet) seen our payment. */
const WAITING = new Set(['created', 'awaiting_funds']);
/** MoneyGram gave up on the transaction; funds were not (or will not be) used. */
const FAILED = new Set(['failed', 'cancelled', 'canceled', 'expired', 'rejected', 'refunded']);

export type RampsOutcome = 'waiting' | 'failed' | 'received';

export function rampsOutcome(status: string): RampsOutcome {
  const s = status.toLowerCase();
  if (WAITING.has(s)) return 'waiting';
  if (FAILED.has(s)) return 'failed';
  // Any other state means MoneyGram has taken the funds (processing, ready for pickup, completed…).
  return 'received';
}

/** Writes MoneyGram's record onto the milestone and returns where it stands. */
export async function applyRampsRecord(escrowId: string, idx: number, tx: RampsTransaction): Promise<RampsOutcome> {
  const outcome = rampsOutcome(tx.status);
  await query(
    `UPDATE escrow_milestones
        SET ramps_status = $3, anchor_status = $3,
            ramps_reference_number = COALESCE($4, ramps_reference_number),
            ramps_destination_country = COALESCE($5, ramps_destination_country),
            ramps_send_usdc = COALESCE($6, ramps_send_usdc),
            anchor_amount_out = COALESCE($7, anchor_amount_out),
            anchor_amount_out_asset = COALESCE($8, anchor_amount_out_asset),
            anchor_fee = COALESCE($9, anchor_fee),
            anchor_fee_asset = COALESCE($10, anchor_fee_asset),
            cashout_status = CASE WHEN $11 = 'received' THEN 'completed'
                                  WHEN $11 = 'failed' THEN 'failed'
                                  ELSE cashout_status END,
            cashout_at = CASE WHEN $11 = 'received' AND cashout_at IS NULL THEN NOW() ELSE cashout_at END,
            cashout_error = CASE WHEN $11 = 'failed' THEN $12 ELSE cashout_error END
      WHERE escrow_id = $1 AND idx = $2 AND cashout_rail = 'moneygram'`,
    [
      escrowId, idx, tx.status, tx.referenceNumber, tx.destinationCountry,
      tx.sendAmount != null ? String(tx.sendAmount) : null,
      tx.receiveAmount, tx.receiveCurrency, tx.feeTotal, tx.feeCurrency,
      outcome, `MoneyGram status: ${tx.status}`,
    ],
  );
  return outcome;
}

/**
 * Polls MoneyGram briefly for the acknowledgement of a payment we just sent.
 * Returns the outcome seen (`waiting` if MoneyGram hasn't moved yet — the
 * scheduled sweep picks it up from there).
 */
export async function awaitRampsAcknowledgement(
  escrowId: string, idx: number, transactionId: string, opts: { tries?: number; delayMs?: number } = {},
): Promise<RampsOutcome> {
  const { tries = 6, delayMs = 3000 } = opts;
  let outcome: RampsOutcome = 'waiting';
  for (let i = 0; i < tries; i++) {
    const tx = await getTransaction(transactionId).catch(() => undefined);
    if (tx) {
      outcome = await applyRampsRecord(escrowId, idx, tx);
      if (outcome !== 'waiting') return outcome;
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return outcome;
}

/** Scheduled sweep: settle every MoneyGram cash-out still waiting on an acknowledgement. */
export async function syncPendingRamps(): Promise<number> {
  if (!moneygramConfigured()) return 0;
  const pending = await query<{ escrow_id: string; idx: number; anchor_tx_id: string }>(
    `SELECT escrow_id, idx, anchor_tx_id FROM escrow_milestones
      WHERE cashout_rail = 'moneygram' AND cashout_status = 'pending'
        AND anchor_tx_id IS NOT NULL AND anchor_settlement_hash IS NOT NULL`,
  );
  if (!pending.rows.length) return 0;

  const byId = new Map((await listTransactions()).map((t) => [t.id, t]));
  let changed = 0;
  for (const row of pending.rows) {
    const tx = byId.get(row.anchor_tx_id);
    if (!tx) continue;
    if ((await applyRampsRecord(row.escrow_id, row.idx, tx)) !== 'waiting') changed++;
  }
  if (changed) logger.info('MoneyGram cash-outs settled', { changed });
  return changed;
}
