/**
 * Keeps a MoneyGram cash-out in step with MoneyGram's own record of it.
 *
 * After we send the USDC deposit, MoneyGram moves the transaction out of
 * `awaiting_funds`; its record then carries the cash-pickup reference number and
 * what the recipient receives. This copies that onto the cash-out and completes
 * it once MoneyGram has acknowledged our payment.
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

/** Writes MoneyGram's record onto the cash-out and returns where it stands. */
export async function applyRampsRecord(cashoutId: string, tx: RampsTransaction): Promise<RampsOutcome> {
  const outcome = rampsOutcome(tx.status);
  await query(
    `UPDATE cashouts
        SET mg_status = $2,
            reference_number = COALESCE($3, reference_number),
            destination_country = COALESCE($4, destination_country),
            send_usdc = COALESCE($5, send_usdc),
            receive_amount = COALESCE($6, receive_amount),
            receive_currency = COALESCE($7, receive_currency),
            fee = COALESCE($8, fee),
            fee_currency = COALESCE($9, fee_currency),
            status = CASE WHEN $10 = 'received' THEN 'completed'
                          WHEN $10 = 'failed' THEN 'failed'
                          ELSE status END,
            completed_at = CASE WHEN $10 = 'received' AND completed_at IS NULL THEN NOW() ELSE completed_at END,
            error = CASE WHEN $10 = 'failed' THEN $11 ELSE error END
      WHERE id = $1`,
    [
      cashoutId, tx.status, tx.referenceNumber, tx.destinationCountry,
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
  cashoutId: string, transactionId: string, opts: { tries?: number; delayMs?: number } = {},
): Promise<RampsOutcome> {
  const { tries = 6, delayMs = 3000 } = opts;
  let outcome: RampsOutcome = 'waiting';
  for (let i = 0; i < tries; i++) {
    const tx = await getTransaction(transactionId).catch(() => undefined);
    if (tx) {
      outcome = await applyRampsRecord(cashoutId, tx);
      if (outcome !== 'waiting') return outcome;
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return outcome;
}

/** Scheduled sweep: settle every MoneyGram cash-out still waiting on an acknowledgement. */
export async function syncPendingRamps(): Promise<number> {
  if (!moneygramConfigured()) return 0;
  const pending = await query<{ id: string; mg_tx_id: string }>(
    `SELECT id, mg_tx_id FROM cashouts WHERE status = 'pending' AND settlement_hash IS NOT NULL`,
  );
  if (!pending.rows.length) return 0;

  const byId = new Map((await listTransactions()).map((t) => [t.id, t]));
  let changed = 0;
  for (const row of pending.rows) {
    const tx = byId.get(row.mg_tx_id);
    if (!tx) continue;
    if ((await applyRampsRecord(row.id, tx)) !== 'waiting') changed++;
  }
  if (changed) logger.info('MoneyGram cash-outs settled', { changed });
  return changed;
}
