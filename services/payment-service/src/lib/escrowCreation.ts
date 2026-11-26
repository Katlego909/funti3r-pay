/**
 * Creating an escrow, crash-safe. Funding an escrow locks the employer's money in the contract, so the chain call is
 * bracketed by a write-ahead record (escrow_creations, migration 033):
 *
 *   begin     a pending row is written before anything is signed (or a retry with the same key is answered from it);
 *   intent    the signed transaction's hash and time bound are stored just before submission;
 *   complete  once the chain confirms it, the escrows + escrow_milestones rows are written in one transaction.
 *
 * If the process dies, the RPC gives no verdict or the database write is lost, the row stays pending with its hash, and
 * settleEscrowCreations reads the chain's final answer after the time bound: found → complete, absent → failed. The
 * escrows table therefore only ever holds escrows that exist on chain, and no funded escrow can go unrecorded.
 */
import crypto from 'node:crypto';
import { query, transaction, notify } from '@funti3r/database';
import { AppError, createLogger } from '@funti3r/shared-utils';
import { contractCallOutcome } from './escrow.js';
import type { OnSigned } from './stellar.js';

const logger = createLogger('EscrowCreation');

/** Past a transaction's time bound it can no longer land; the grace covers the RPC's ingestion lag. */
const TIME_BOUND_GRACE_MINUTES = 2;
/** A pending row that never stored a hash: nothing was signed, and nothing ever will be once the request is gone. */
const STALE_UNSIGNED_MINUTES = 5;

export interface MilestoneSpec { description?: string; amountXlm: string }

export interface CreationRequest {
  enterpriseId: string;
  workerId: string;
  milestones: MilestoneSpec[];
  expiresAt: Date;
  idempotencyKey?: string;
}

export type BeginResult =
  | { kind: 'new'; creationId: string }
  | { kind: 'done'; escrowId: string; onchainEscrowId: string; txHash: string | null }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' };

/** The fields that make two requests "the same escrow": a reused key with different ones is refused. */
function payloadHash(r: CreationRequest): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    workerId: r.workerId,
    milestones: r.milestones.map((m) => ({ description: m.description ?? null, amountXlm: m.amountXlm })),
    expiresAt: r.expiresAt.toISOString(),
  })).digest('hex');
}

/**
 * Starts a creation, or answers a retry of one: `done` replays the escrow it made, `in_progress` means it is still
 * waiting for the chain (never sign again then), and a failed one is reopened for a genuine retry.
 */
export async function beginEscrowCreation(r: CreationRequest): Promise<BeginResult> {
  const hash = payloadHash(r);
  if (r.idempotencyKey) {
    const existing = await query(
      `SELECT c.id, c.status, c.payload_hash, c.escrow_id, e.onchain_escrow_id, e.create_tx_hash
         FROM escrow_creations c LEFT JOIN escrows e ON e.id = c.escrow_id
        WHERE c.enterprise_id = $1 AND c.idempotency_key = $2`,
      [r.enterpriseId, r.idempotencyKey],
    );
    const row = existing.rows[0];
    if (row) {
      if (row.payload_hash !== hash) return { kind: 'mismatch' };
      if (row.status === 'done') {
        return { kind: 'done', escrowId: row.escrow_id, onchainEscrowId: String(row.onchain_escrow_id), txHash: row.create_tx_hash };
      }
      if (row.status === 'pending') return { kind: 'in_progress' };
      // Failed: nothing landed. Compare-and-swap, so two concurrent retries cannot both reopen it.
      const reopened = await query(
        `UPDATE escrow_creations SET status = 'pending', tx_hash = NULL, tx_max_time = NULL, failure_reason = NULL, updated_at = NOW()
          WHERE id = $1 AND status = 'failed' RETURNING id`,
        [row.id],
      );
      return reopened.rows.length ? { kind: 'new', creationId: row.id } : { kind: 'in_progress' };
    }
  }
  try {
    const ins = await query(
      `INSERT INTO escrow_creations (enterprise_id, worker_id, contract_address, milestones, expires_at, idempotency_key, payload_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [r.enterpriseId, r.workerId, process.env.ESCROW_CONTRACT_ADDRESS, JSON.stringify(r.milestones), r.expiresAt,
        r.idempotencyKey ?? null, r.idempotencyKey ? hash : null],
    );
    return { kind: 'new', creationId: ins.rows[0].id };
  } catch (err: any) {
    if (err?.code === '23505' && r.idempotencyKey) return { kind: 'in_progress' }; // lost the race to an identical request
    throw err;
  }
}

/** Write-ahead: stores the signed hash before submission, and refuses to sign for a creation no longer pending. */
export function recordCreationIntent(creationId: string): OnSigned {
  return async (hash, maxTime) => {
    const r = await query(
      `UPDATE escrow_creations SET tx_hash = $1, tx_max_time = $2, updated_at = NOW()
        WHERE id = $3 AND status = 'pending' RETURNING id`,
      [hash, maxTime, creationId],
    );
    if (r.rows.length === 0) throw new AppError(409, 'This escrow is no longer being created', 'escrow_not_pending');
  };
}

/**
 * Turns a creation the chain has confirmed into its escrows + escrow_milestones rows, in one transaction, and tells
 * the worker. Idempotent: the route and the reconciler can both reach it; the row lock lets only the first one write.
 */
export async function completeEscrowCreation(
  creationId: string, onchainEscrowId: bigint, txHash: string,
): Promise<{ escrowId: string; created: boolean; workerId: string; total: number }> {
  const out = await transaction(async (client) => {
    const c = (await client.query(`SELECT * FROM escrow_creations WHERE id = $1 FOR UPDATE`, [creationId])).rows[0];
    if (!c) throw new Error(`Escrow creation ${creationId} not found`);
    const milestones = c.milestones as MilestoneSpec[];
    const total = milestones.reduce((s, m) => s + Number(m.amountXlm), 0);
    const count = milestones.length;
    if (c.status === 'done') return { escrowId: c.escrow_id as string, created: false, workerId: c.worker_id as string, total, count };

    const ins = await client.query(
      `INSERT INTO escrows (enterprise_id, worker_id, contract_address, onchain_escrow_id,
                            token_code, total_amount, status, expires_at, create_tx_hash)
       VALUES ($1, $2, $3, $4, 'XLM', $5, 'active', $6, $7)
       RETURNING id`,
      [c.enterprise_id, c.worker_id, c.contract_address, onchainEscrowId.toString(), total, c.expires_at, txHash],
    );
    const escrowId = ins.rows[0].id as string;
    const values: unknown[] = [];
    const placeholders = milestones.map((m, i) => {
      values.push(escrowId, i, m.description ?? null, m.amountXlm);
      const base = i * 4;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });
    await client.query(
      `INSERT INTO escrow_milestones (escrow_id, idx, description, amount) VALUES ${placeholders.join(', ')}`,
      values,
    );
    await client.query(
      `UPDATE escrow_creations SET status = 'done', escrow_id = $1, tx_hash = $2, updated_at = NOW() WHERE id = $3`,
      [escrowId, txHash, creationId],
    );
    return { escrowId, created: true, workerId: c.worker_id as string, total, count };
  });
  if (out.created) {
    await notify({
      userId: out.workerId, type: 'escrow_created', title: 'New milestone escrow',
      body: `Your employer locked ${out.total} XLM across ${out.count} milestone(s) for you.`,
      entityType: 'escrow', entityId: out.escrowId,
    });
  }
  return { escrowId: out.escrowId, created: out.created, workerId: out.workerId, total: out.total };
}

/** Records that nothing landed, so a same-key retry may sign again. Only a pending creation can fail. */
export async function failEscrowCreation(creationId: string, reason: string): Promise<void> {
  await query(
    `UPDATE escrow_creations SET status = 'failed', failure_reason = $1, updated_at = NOW() WHERE id = $2 AND status = 'pending'`,
    [reason.slice(0, 500), creationId],
  );
}

/**
 * Settles creations left pending (the process died, the RPC gave no verdict, or the escrows write was lost) from the
 * chain once its answer is final. An RPC error leaves the row for the next run: it is never failed without an answer.
 */
export async function settleEscrowCreations(): Promise<{ completed: number; failed: number }> {
  const stale = await query(
    `SELECT id, tx_hash FROM escrow_creations
      WHERE status = 'pending'
        AND CASE WHEN tx_max_time IS NOT NULL
                 THEN tx_max_time < NOW() - INTERVAL '${TIME_BOUND_GRACE_MINUTES} minutes'
                 ELSE updated_at < NOW() - INTERVAL '${STALE_UNSIGNED_MINUTES} minutes' END`,
  );
  let completed = 0;
  let failed = 0;
  for (const row of stale.rows as Array<{ id: string; tx_hash: string | null }>) {
    if (!row.tx_hash) {
      await failEscrowCreation(row.id, 'Nothing was signed');
      failed++;
      continue;
    }
    let outcome: Awaited<ReturnType<typeof contractCallOutcome>>;
    try {
      outcome = await contractCallOutcome(row.tx_hash);
    } catch (err) {
      logger.warn('Could not check a pending escrow creation on chain; will retry', { creationId: row.id, error: String(err) });
      continue;
    }
    if (outcome.found && outcome.successful && typeof outcome.returnValue === 'bigint') {
      const done = await completeEscrowCreation(row.id, outcome.returnValue, row.tx_hash);
      logger.warn('Recorded an escrow the chain had confirmed', { creationId: row.id, escrowId: done.escrowId, txHash: row.tx_hash });
      completed++;
    } else {
      await failEscrowCreation(row.id, outcome.found ? 'Failed on chain' : 'Not on chain after its time bound');
      failed++;
    }
  }
  return { completed, failed };
}
