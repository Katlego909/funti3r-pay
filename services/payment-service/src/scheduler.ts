import crypto from 'node:crypto';
import cron from 'node-cron';
import axios from 'axios';
import { query, tryWithAdvisoryLock } from '@funti3r/database';
import { createLogger, stampIdentity } from '@funti3r/shared-utils';
import { nextRunDate } from './lib/scheduling.js';
import { reconcileEscrows } from './lib/escrowReconcile.js';
import { syncPendingRamps } from './lib/rampsSync.js';
import { findTransactionByMemoHash } from './lib/stellar.js';
import { recordAllMissingEscrowPayments } from './lib/escrowAccounting.js';
import { notifyPaymentSettled } from './lib/paymentNotifications.js';
import { jobRunsTotal, jobSeconds, stuckCashouts, stuckPayments } from './lib/metrics.js';

const logger = createLogger('Scheduler');

// ── Schedule executor ─────────────────────────────────────────────────────────

const PAYMENT_SERVICE_URL = `http://localhost:${process.env.PAYMENT_SERVICE_PORT ?? 3002}`;

/**
 * Headers for a scheduled run, acting as the schedule's enterprise. Signed like the gateway's, because the payout
 * routes reject identity headers without a valid signature.
 */
export function scheduleRunHeaders(enterpriseId: string, now = Date.now()): Record<string, string> {
  const headers: Record<string, string> = {
    'x-user-id': enterpriseId,
    'x-user-role': 'enterprise',
    'content-type': 'application/json',
  };
  stampIdentity(headers, now);
  return headers;
}

async function runDueSchedules(): Promise<void> {
  // Claim due schedules atomically: update next_run_at first so a concurrent
  // run (e.g. after a restart) won't pick the same schedule again.
  const claimed = await query<{
    id: string;
    enterprise_id: string;
    name: string;
    frequency: string;
    run_day: string;
    timezone: string;
    last_run_at: string;
  }>(`
    UPDATE payment_schedules
    SET last_run_at = NOW(), updated_at = NOW()
    WHERE status = 'active' AND next_run_at <= NOW()
    RETURNING id, enterprise_id, name, frequency, run_day, timezone, last_run_at
  `);

  if (claimed.rows.length === 0) return;

  logger.info(`Running ${claimed.rows.length} due schedule(s)`);

  // One query for every claimed schedule's items instead of one per schedule
  // (same batching this file's sibling route, routes/schedules.ts, already
  // does for GET /schedules) — matters when several schedules are due in the
  // same hourly tick.
  const scheduleIds = claimed.rows.map((s) => s.id);
  const allItemsRes = await query<{ schedule_id: string; worker_id: string; amount_usd: string; memo: string | null }>(
    'SELECT schedule_id, worker_id, amount_usd, memo FROM payment_schedule_items WHERE schedule_id = ANY($1::uuid[])',
    [scheduleIds],
  );
  const itemsBySchedule = new Map<string, Array<{ worker_id: string; amount_usd: string; memo: string | null }>>();
  for (const row of allItemsRes.rows) {
    if (!itemsBySchedule.has(row.schedule_id)) itemsBySchedule.set(row.schedule_id, []);
    itemsBySchedule.get(row.schedule_id)!.push(row);
  }

  for (const schedule of claimed.rows) {
    await executeSchedule(schedule, itemsBySchedule.get(schedule.id) ?? []);
  }
}

async function executeSchedule(
  schedule: {
    id: string;
    enterprise_id: string;
    name: string;
    frequency: string;
    run_day: string;
    timezone: string;
    last_run_at: string;
  },
  itemRows: Array<{ worker_id: string; amount_usd: string; memo: string | null }>,
): Promise<void> {
  const { id, enterprise_id, name, frequency, run_day, timezone, last_run_at } = schedule;

  if (itemRows.length === 0) {
    logger.warn('Schedule has no items — skipping', { scheduleId: id });
    await updateScheduleAfterRun(id, frequency, run_day, timezone, 'failed');
    return;
  }

  const items = itemRows.map((r) => ({
    workerId: r.worker_id,
    amountUsd: Number(r.amount_usd),
    memo: r.memo ?? undefined,
  }));

  let runStatus: 'success' | 'partial' | 'failed';

  try {
    // Deterministic per-due-run key: stable if this exact run is retried (e.g.
    // the process crashes between claiming the schedule and finishing it, so
    // the next hourly tick sees it still due), changes on the next legitimate run.
    const idempotencyKey = `schedule:${id}:${last_run_at}`;
    const response = await axios.post(
      `${PAYMENT_SERVICE_URL}/payouts/batch`,
      { enterpriseId: enterprise_id, items, idempotencyKey },
      {
        headers: scheduleRunHeaders(enterprise_id),
        timeout: 120_000,
      },
    );

    // 'processing' means some payments are still awaiting their on-chain verdict: money may well have moved, so the
    // run is not a failure; 'partial' is the closest outcome the schedule records (the watchdog settles each payment).
    runStatus = response.data.status === 'completed' ? 'success'
      : response.data.status === 'partial' || response.data.status === 'processing' ? 'partial'
      : 'failed';

    logger.info('Schedule run complete', {
      scheduleId: id,
      name,
      status: runStatus,
      completed: response.data.completedCount,
      failed: response.data.failedCount,
    });
  } catch (err: any) {
    const detail = err?.response?.data?.error ?? err?.message ?? String(err);
    logger.error('Schedule run failed', { scheduleId: id, name, error: detail });
    runStatus = 'failed';
  }

  await updateScheduleAfterRun(id, frequency, run_day, timezone, runStatus);
}

async function updateScheduleAfterRun(
  id: string,
  frequency: string,
  runDay: string,
  timezone: string,
  runStatus: 'success' | 'partial' | 'failed',
): Promise<void> {
  try {
    const nextRun = nextRunDate(frequency, runDay, timezone, new Date());
    await query(
      `UPDATE payment_schedules
          SET next_run_at = $1, last_run_status = $2, updated_at = NOW()
        WHERE id = $3`,
      [nextRun.toISOString(), runStatus, id],
    );
  } catch (err) {
    logger.error('Failed to update next_run_at', { scheduleId: id, error: String(err) });
  }
}

// ── Reconciliation watchdog ───────────────────────────────────────────────────
//
// Cleans up payment/batch state that got stuck when a process crashed
// mid-request, so a later idempotency-key retry (see index.ts) isn't blocked
// forever by a row that will never resolve on its own.

// Past every payout transaction's 60s time bound (lib/stellar.ts), with margin: a transaction not on chain by now
// never will be, so the chain's answer is final.
const STALE_INITIATED_MINUTES = 5;
const STALE_BATCH_HEARTBEAT_MINUTES = 3; // batches heartbeat every item; use this, not updated_at

/**
 * Settles a payout left 'initiated' (the process died mid-request) or 'submitted' (Horizon gave no verdict) from the
 * chain: its transaction carries Memo.hash(sha256(paymentId)) from the enterprise account. Found → completed (or
 * pending_claim for the claimable-balance fallback). Absent → failed, and only then may a same-key retry pay again.
 * A Horizon error leaves the row for the next run; it is never failed without the chain's answer.
 */
export async function reconcileStalePayments(): Promise<void> {
  const stale = await query(
    `SELECT p.id, p.enterprise_id, p.worker_id, p.amount, p.currency, p.created_at,
            e.stellar_public_key AS enterprise_public_key, w.email AS worker_email
       FROM payments p
       JOIN users e ON e.id = p.enterprise_id
       LEFT JOIN users w ON w.id = p.worker_id
      WHERE p.status IN ('initiated', 'submitted') AND p.updated_at < NOW() - INTERVAL '${STALE_INITIATED_MINUTES} minutes'`,
  ) as { rows: Array<{
    id: string; enterprise_id: string; worker_id: string; amount: string; currency: string; created_at: Date;
    enterprise_public_key: string | null; worker_email: string | null;
  }> };

  for (const p of stale.rows) {
    let found: Awaited<ReturnType<typeof findTransactionByMemoHash>> = null;
    if (p.enterprise_public_key) {
      try {
        const memoHash = crypto.createHash('sha256').update(p.id).digest();
        found = await findTransactionByMemoHash(p.enterprise_public_key, memoHash, new Date(p.created_at));
      } catch (err) {
        logger.warn('Could not check a stale payment on chain; will retry', { paymentId: p.id, error: String(err) });
        continue;
      }
    }

    if (found) {
      const status = found.claimable ? 'pending_claim' : 'completed';
      const upd = await query(
        `UPDATE payments
            SET status = $1::text, stellar_tx_hash = $2, failure_reason = NULL, updated_at = NOW(),
                completed_at = CASE WHEN $1::text = 'completed' THEN NOW() ELSE NULL END
          WHERE id = $3 AND status IN ('initiated', 'submitted') RETURNING id`,
        [status, found.hash, p.id],
      );
      if (upd.rows.length === 0) continue;
      logger.warn('Settled stale payment from chain', { paymentId: p.id, status, txHash: found.hash });
      await notifyPaymentSettled({
        paymentId: p.id, enterpriseId: p.enterprise_id, workerId: p.worker_id, workerEmail: p.worker_email ?? 'your worker',
        amount: p.amount, asset: p.currency, status,
      });
    } else {
      await query(
        `UPDATE payments
            SET status = 'failed', failure_reason = 'Not on chain after its time bound — safe to retry', failed_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status IN ('initiated', 'submitted')`,
        [p.id],
      );
      logger.warn('Stale payment not on chain; marked failed', { paymentId: p.id });
    }
  }
}

async function reconcileStuckPayments(): Promise<void> {
  await reconcileStalePayments();

  // Batches use heartbeat_at (bumped once per item in the sequential loop),
  // NOT updated_at — updated_at only changes at batch-start and batch-finish,
  // so a large healthy batch would otherwise look identical to a crashed one.
  const staleBatches = await query(
    `SELECT id, payment_count FROM payment_batches
      WHERE status = 'processing' AND heartbeat_at < NOW() - INTERVAL '${STALE_BATCH_HEARTBEAT_MINUTES} minutes'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.batch_id = payment_batches.id AND p.status IN ('initiated', 'submitted'))`,
  ) as { rows: Array<{ id: string; payment_count: number }> };

  if (staleBatches.rows.length > 0) {
    // Recompute from ground truth for every stale batch in one query instead
    // of one GROUP BY per batch — the payments rows already reflect exactly
    // what happened before the crash, whether or not the loop finished.
    const batchIds = staleBatches.rows.map((b) => b.id);
    const counts = await query(
      `SELECT batch_id, status, COUNT(*) AS count FROM payments WHERE batch_id = ANY($1::uuid[]) GROUP BY batch_id, status`,
      [batchIds],
    ) as { rows: Array<{ batch_id: string; status: string; count: string }> };
    const countsByBatch = new Map<string, Array<{ status: string; count: string }>>();
    for (const row of counts.rows) {
      if (!countsByBatch.has(row.batch_id)) countsByBatch.set(row.batch_id, []);
      countsByBatch.get(row.batch_id)!.push(row);
    }

    for (const batch of staleBatches.rows) {
      const batchCounts = countsByBatch.get(batch.id) ?? [];
      // pending_claim moved the money too (a claimable balance), as the batch route counts it.
      const completed = batchCounts
        .filter((r) => r.status === 'completed' || r.status === 'pending_claim')
        .reduce((n, r) => n + Number(r.count), 0);
      const failedOrMissing = Number(batch.payment_count) - completed;
      const batchStatus = failedOrMissing === 0 ? 'completed' : completed === 0 ? 'failed' : 'partial';

      await query(
        `UPDATE payment_batches SET status = $1, updated_at = NOW() WHERE id = $2 AND status = 'processing'`,
        [batchStatus, batch.id],
      );
      logger.warn('Reconciled stale processing batch', { batchId: batch.id, status: batchStatus, completed, failedOrMissing });
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs a job on every tick, but only on one instance at a time: each instance schedules it, the first to take the
 * cluster-wide lock runs it and the others skip that tick. A job still running when the next tick arrives is skipped
 * the same way, so a slow run never stacks up behind itself.
 */
function singleton(name: string, job: () => Promise<unknown>): () => void {
  return () => {
    const stop = jobSeconds.startTimer({ job: name });
    tryWithAdvisoryLock(`job:${name}`, job)
      .then((r) => {
        jobRunsTotal.inc({ job: name, outcome: r.ran ? 'ran' : 'skipped' });
        if (r.ran) stop();
      })
      .catch((err) => {
        jobRunsTotal.inc({ job: name, outcome: 'failed' });
        logger.error(`Unhandled error in ${name}`, { error: String(err) });
      });
  };
}

/** Counts what is stuck, for the alerts. Every instance does this for itself; it only reads. */
async function refreshStuckGauges(): Promise<void> {
  const cashouts = await query(
    `SELECT count(*)::int AS n FROM cashouts WHERE status = 'pending' AND created_at < NOW() - INTERVAL '15 minutes'`,
  );
  const payments = await query(
    `SELECT count(*)::int AS n FROM payments WHERE status IN ('initiated', 'submitted') AND created_at < NOW() - INTERVAL '10 minutes'`,
  );
  stuckCashouts.set(cashouts.rows[0]?.n ?? 0);
  stuckPayments.set(payments.rows[0]?.n ?? 0);
}

export function startScheduler(): void {
  cron.schedule('* * * * *', () => {
    refreshStuckGauges().catch((err) => logger.warn('Could not refresh the stuck-money gauges', { error: String(err) }));
  });

  // Check for due schedules every hour, on the hour.
  cron.schedule('0 * * * *', singleton('runDueSchedules', runDueSchedules));

  // Sweep for stuck payments/batches every 2 minutes.
  cron.schedule('*/2 * * * *', singleton('reconcileStuckPayments', reconcileStuckPayments));

  // Keep the escrows mirror in line with the contract (chain is the source of
  // truth): every 5 minutes, and once shortly after boot.
  const runEscrowReconcile = singleton('reconcileEscrows', () =>
    reconcileEscrows()
      // Claimed milestones must all be in the books, even if recording one failed earlier.
      .then(async (r) => {
        await recordAllMissingEscrowPayments();
        return r;
      })
      .then((r) => {
        if (r.drift.length || r.unreadable) logger.warn('Escrow reconcile finished with findings', r);
      }));
  cron.schedule('*/5 * * * *', runEscrowReconcile);

  // MoneyGram cash-outs we've paid but MoneyGram hasn't acknowledged yet.
  cron.schedule('* * * * *', singleton('syncPendingRamps', syncPendingRamps));
  setTimeout(runEscrowReconcile, 15_000);

  logger.info('Scheduler started — checking for due schedules every hour, reconciling stuck payments every 2 minutes');
}
