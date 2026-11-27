/**
 * The platform admin's view of money: one account's wallet and history, platform-wide lists, what is stuck or failing,
 * and the audit trail. Read by the admin console through /admin (admin-only at the gateway and in this service).
 *
 * Columns are always named: never SELECT * here (payments still carries a legacy stellar_source_secret column).
 */
import { oneOf, pageOf, where } from '@funti3r/database';
import { escapeLike, isUuid } from '@funti3r/shared-utils';

interface Rows { rows: any[] }
export interface AdminViewDeps {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  /** An account's balances; an account not yet on chain has none. */
  balances: (publicKey: string) => Promise<unknown[]>;
  /** The sponsor's public key and spendable XLM, or null when no sponsor is configured. */
  sponsor: () => Promise<{ publicKey: string; spendableXlm: number } | null>;
  /** The escrow contract's address, admin and whether USDC is allowed. */
  contract: () => Promise<{ address: string; admin: string; tokenAllowed: boolean }>;
}

const TX_HASH = /^[0-9a-f]{64}$/i;
const PAYMENT_STATUSES = ['initiated', 'submitted', 'completed', 'pending_claim', 'failed'] as const;
const ESCROW_STATUSES = ['active', 'completed', 'refunded'] as const;
const CASHOUT_STATUSES = ['pending', 'completed', 'failed'] as const;
const BATCH_STATUSES = ['processing', 'completed', 'partial', 'failed'] as const;
const SCHEDULE_STATUSES = ['active', 'paused'] as const;

export interface ListQuery { status?: string; q?: string; limit?: string | number; offset?: string | number }

const PAYMENT_COLUMNS = `p.id, p.enterprise_id, e.email AS enterprise_email, p.worker_id, w.email AS worker_email, p.amount,
  p.currency, p.status, p.failure_reason, p.stellar_tx_hash, p.batch_id, p.description, p.created_at, p.completed_at,
  p.failed_at, p.chain_verified_at`;

/**
 * Payments platform-wide, newest first. `q` finds a payment by its id or transaction hash, or everything to or from one
 * account by its id; `batchId` narrows to one payout batch.
 */
export async function listPayments(q: ListQuery & { batchId?: string }, deps: AdminViewDeps) {
  const { limit, offset } = pageOf(q);
  const term = q.q?.trim() ?? '';
  const status = oneOf(q.status, PAYMENT_STATUSES);
  const w = where([
    status ? ['p.status = ?', status] : null,
    isUuid(q.batchId) ? ['p.batch_id = ?', q.batchId] : null,
    isUuid(term) ? ['? IN (p.id, p.enterprise_id, p.worker_id)', term] : null,
    TX_HASH.test(term) ? ['p.stellar_tx_hash = ?', term.toLowerCase()] : null,
  ]);
  const rows = await deps.query(
    `SELECT ${PAYMENT_COLUMNS}
       FROM payments p JOIN users e ON e.id = p.enterprise_id LEFT JOIN users w ON w.id = p.worker_id
       ${w.sql} ORDER BY p.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    w.params,
  );
  return { payments: rows.rows, limit, offset };
}

const ESCROW_COLUMNS = `x.id, x.onchain_escrow_id, x.enterprise_id, e.email AS enterprise_email, x.worker_id,
  w.email AS worker_email, x.token_code, x.total_amount, x.status, x.frozen, x.expires_at, x.create_tx_hash, x.created_at,
  (SELECT COUNT(*) FROM escrow_milestones m WHERE m.escrow_id = x.id AND m.status = 'claimed')::int AS claimed,
  (SELECT COUNT(*) FROM escrow_milestones m WHERE m.escrow_id = x.id)::int AS milestones`;

/** Escrows platform-wide, newest first; `frozen=true` narrows to the compliance-held ones. */
export async function listEscrows(q: ListQuery & { frozen?: string }, deps: AdminViewDeps) {
  const { limit, offset } = pageOf(q);
  const status = oneOf(q.status, ESCROW_STATUSES);
  const w = where([
    status ? ['x.status = ?', status] : null,
    q.frozen === 'true' ? ['x.frozen = ?', true] : null,
    isUuid(q.q?.trim()) ? ['? IN (x.id, x.enterprise_id, x.worker_id)', q.q!.trim()] : null,
  ]);
  const rows = await deps.query(
    `SELECT ${ESCROW_COLUMNS}
       FROM escrows x JOIN users e ON e.id = x.enterprise_id JOIN users w ON w.id = x.worker_id
       ${w.sql} ORDER BY x.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    w.params,
  );
  return { escrows: rows.rows, limit, offset };
}

const CASHOUT_COLUMNS = `c.id, c.worker_id, u.email AS worker_email, c.status, c.mg_status, c.send_usdc, c.xlm_spent,
  c.settlement_hash, c.reference_number, c.destination_country, c.receive_amount, c.receive_currency, c.error,
  c.created_at, c.completed_at`;

/** MoneyGram cash-outs platform-wide, newest first. */
export async function listCashouts(q: ListQuery, deps: AdminViewDeps) {
  const { limit, offset } = pageOf(q);
  const status = oneOf(q.status, CASHOUT_STATUSES);
  const w = where([
    status ? ['c.status = ?', status] : null,
    isUuid(q.q?.trim()) ? ['? IN (c.id, c.worker_id)', q.q!.trim()] : null,
  ]);
  const rows = await deps.query(
    `SELECT ${CASHOUT_COLUMNS} FROM cashouts c JOIN users u ON u.id = c.worker_id
       ${w.sql} ORDER BY c.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    w.params,
  );
  return { cashouts: rows.rows, limit, offset };
}

/**
 * One account's money, whether it pays (an employer) or is paid (a worker): its wallet and balances, recent payments
 * with their failure reasons, escrows, cash-outs and payroll schedules. Null for an unknown account.
 */
export async function accountMoney(userId: string, deps: AdminViewDeps) {
  const user = (await deps.query('SELECT id, role, stellar_public_key FROM users WHERE id = $1', [userId])).rows[0];
  if (!user) return null;
  const [balances, payments, escrows, cashouts, schedules] = await Promise.all([
    user.stellar_public_key ? deps.balances(user.stellar_public_key) : Promise.resolve([]),
    deps.query(
      `SELECT ${PAYMENT_COLUMNS}
         FROM payments p JOIN users e ON e.id = p.enterprise_id LEFT JOIN users w ON w.id = p.worker_id
        WHERE $1 IN (p.enterprise_id, p.worker_id) ORDER BY p.created_at DESC LIMIT 50`,
      [userId],
    ),
    deps.query(
      `SELECT ${ESCROW_COLUMNS}
         FROM escrows x JOIN users e ON e.id = x.enterprise_id JOIN users w ON w.id = x.worker_id
        WHERE $1 IN (x.enterprise_id, x.worker_id) ORDER BY x.created_at DESC LIMIT 50`,
      [userId],
    ),
    deps.query(
      `SELECT ${CASHOUT_COLUMNS} FROM cashouts c JOIN users u ON u.id = c.worker_id
        WHERE c.worker_id = $1 ORDER BY c.created_at DESC LIMIT 50`,
      [userId],
    ),
    deps.query(
      `SELECT id, name, frequency, status, next_run_at, last_run_at, last_run_status
         FROM payment_schedules WHERE enterprise_id = $1 ORDER BY created_at DESC`,
      [userId],
    ),
  ]);
  return {
    wallet: { address: user.stellar_public_key, balances },
    payments: payments.rows, escrows: escrows.rows, cashouts: cashouts.rows, schedules: schedules.rows,
  };
}

/**
 * Payout batches platform-wide, newest first, with how their payments ended (paid, waiting to be claimed, failed, still
 * on the way): a 'partial' batch is the one to look at.
 * `q` narrows to one employer by account id.
 */
export async function listBatches(q: ListQuery, deps: AdminViewDeps) {
  const { limit, offset } = pageOf(q);
  const status = oneOf(q.status, BATCH_STATUSES);
  const w = where([
    status ? ['b.status = ?', status] : null,
    isUuid(q.q?.trim()) ? ['? IN (b.id, b.enterprise_id)', q.q!.trim()] : null,
  ]);
  const rows = await deps.query(
    `SELECT b.id, b.enterprise_id, e.email AS enterprise_email, b.payment_count, b.total_amount, b.status, b.created_at,
            b.updated_at, b.unsent,
            COUNT(p.id) FILTER (WHERE p.status = 'completed')::int AS completed,
            COUNT(p.id) FILTER (WHERE p.status = 'pending_claim')::int AS awaiting_claim,
            COUNT(p.id) FILTER (WHERE p.status = 'failed')::int AS failed,
            COUNT(p.id) FILTER (WHERE p.status IN ('initiated', 'submitted'))::int AS in_flight
       FROM payment_batches b JOIN users e ON e.id = b.enterprise_id LEFT JOIN payments p ON p.batch_id = b.id
       ${w.sql} GROUP BY b.id, e.email ORDER BY b.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    w.params,
  );
  return { batches: rows.rows, limit, offset };
}

/** Recurring payroll schedules platform-wide, soonest next run first, with how many people each pays and how much. */
export async function listSchedules(q: ListQuery, deps: AdminViewDeps) {
  const { limit, offset } = pageOf(q);
  const status = oneOf(q.status, SCHEDULE_STATUSES);
  const w = where([
    status ? ['s.status = ?', status] : null,
    isUuid(q.q?.trim()) ? ['? IN (s.id, s.enterprise_id)', q.q!.trim()] : null,
  ]);
  const rows = await deps.query(
    `SELECT s.id, s.enterprise_id, e.email AS enterprise_email, s.name, s.frequency, s.run_day, s.timezone, s.status,
            s.next_run_at, s.last_run_at, s.last_run_status, s.last_run_error, s.last_run_batch_id, s.created_at,
            COUNT(i.id)::int AS items, COALESCE(SUM(i.amount_usd), 0) AS total_usd
       FROM payment_schedules s JOIN users e ON e.id = s.enterprise_id LEFT JOIN payment_schedule_items i ON i.schedule_id = s.id
       ${w.sql} GROUP BY s.id, e.email ORDER BY s.next_run_at LIMIT ${limit} OFFSET ${offset}`,
    w.params,
  );
  return { schedules: rows.rows, limit, offset };
}

/** One escrow with every milestone, its review state and the transaction behind each step. Null when unknown. */
export async function escrowDetail(id: string, deps: AdminViewDeps) {
  const escrow = (await deps.query(
    `SELECT ${ESCROW_COLUMNS}, x.contract_address, x.updated_at
       FROM escrows x JOIN users e ON e.id = x.enterprise_id JOIN users w ON w.id = x.worker_id
      WHERE x.id = $1`,
    [id],
  )).rows[0];
  if (!escrow) return null;
  const milestones = await deps.query(
    `SELECT idx, description, amount, status, review_status, approved_at, claimed_at, approve_tx_hash, claim_tx_hash,
            refund_tx_hash
       FROM escrow_milestones WHERE escrow_id = $1 ORDER BY idx`,
    [id],
  );
  return { escrow, milestones: milestones.rows };
}

/** One payroll schedule with who it pays and how much. Null when unknown. */
export async function scheduleDetail(id: string, deps: AdminViewDeps) {
  const schedule = (await deps.query(
    `SELECT s.id, s.enterprise_id, e.email AS enterprise_email, s.name, s.frequency, s.run_day, s.timezone, s.status,
            s.next_run_at, s.last_run_at, s.last_run_status, s.last_run_error, s.last_run_batch_id, s.created_at
       FROM payment_schedules s JOIN users e ON e.id = s.enterprise_id
      WHERE s.id = $1`,
    [id],
  )).rows[0];
  if (!schedule) return null;
  const items = await deps.query(
    `SELECT i.worker_id, u.email AS worker_email, i.amount_usd, i.memo
       FROM payment_schedule_items i LEFT JOIN users u ON u.id = i.worker_id
      WHERE i.schedule_id = $1 ORDER BY u.email`,
    [id],
  );
  return { schedule, items: items.rows };
}

/** A read that may fail (the network, the contract): its value, or the error text instead of failing the page. */
async function settle<T>(read: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await read();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * What needs an operator's attention, platform-wide: payments and cash-outs stuck past their limits (the same limits
 * the alerts use), escrow creations still waiting for the chain, payouts that failed in the last day and why, the
 * sponsor's balance, and the contract's admin and token allowlist.
 */
export async function opsOverview(deps: AdminViewDeps) {
  const [stuckPayments, stuckCashouts, pendingCreations, failedReasons, sponsor, contract] = await Promise.all([
    deps.query(
      `SELECT ${PAYMENT_COLUMNS}
         FROM payments p JOIN users e ON e.id = p.enterprise_id LEFT JOIN users w ON w.id = p.worker_id
        WHERE p.status IN ('initiated', 'submitted') AND p.created_at < NOW() - INTERVAL '10 minutes'
        ORDER BY p.created_at LIMIT 50`,
    ),
    deps.query(
      `SELECT ${CASHOUT_COLUMNS} FROM cashouts c JOIN users u ON u.id = c.worker_id
        WHERE c.status = 'pending' AND c.created_at < NOW() - INTERVAL '15 minutes'
        ORDER BY c.created_at LIMIT 50`,
    ),
    deps.query(
      `SELECT c.id, c.enterprise_id, e.email AS enterprise_email, c.token_code, c.tx_hash, c.tx_max_time, c.created_at
         FROM escrow_creations c JOIN users e ON e.id = c.enterprise_id
        WHERE c.status = 'pending' ORDER BY c.created_at LIMIT 50`,
    ),
    deps.query(
      `SELECT COALESCE(failure_reason, 'unknown') AS reason, COUNT(*)::int AS count
         FROM payments WHERE status = 'failed' AND failed_at > NOW() - INTERVAL '24 hours'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    ),
    settle(deps.sponsor),
    settle(deps.contract),
  ]);
  return {
    stuckPayments: stuckPayments.rows,
    stuckCashouts: stuckCashouts.rows,
    pendingEscrowCreations: pendingCreations.rows,
    failedPayouts24h: {
      total: failedReasons.rows.reduce((n: number, r: { count: number }) => n + r.count, 0),
      byReason: failedReasons.rows,
    },
    sponsor,
    contract,
  };
}

/**
 * The audit trail, newest first, narrowed by what it happened to, who did it, or the action. Each event carries the
 * emails of who acted, of the account it was about and of the worker a payment or escrow was for, so the console can
 * say it in words instead of ids.
 */
export async function listAudit(
  q: ListQuery & { entityType?: string; entityId?: string; actorId?: string; action?: string }, deps: AdminViewDeps,
) {
  const { limit, offset } = pageOf(q);
  const w = where([
    q.entityType ? ['a.entity_type = ?', q.entityType] : null,
    q.entityId ? ['a.entity_id = ?', q.entityId] : null,
    isUuid(q.actorId) ? ['a.actor_id = ?', q.actorId] : null,
    q.action ? ['a.action LIKE ?', `${escapeLike(q.action)}%`] : null,
  ]);
  const rows = await deps.query(
    `SELECT a.id, a.at, a.actor_id, actor.email AS actor_email, a.actor_role, a.action, a.entity_type, a.entity_id,
            target.email AS entity_email, worker.email AS worker_email, a.detail, a.request_id
       FROM audit_events a
       LEFT JOIN users actor ON actor.id = a.actor_id
       LEFT JOIN users target ON a.entity_type = 'user' AND target.id::text = a.entity_id
       LEFT JOIN users worker ON worker.id::text = a.detail->>'workerId'
       ${w.sql} ORDER BY a.at DESC LIMIT ${limit} OFFSET ${offset}`,
    w.params,
  );
  return { events: rows.rows, limit, offset };
}
