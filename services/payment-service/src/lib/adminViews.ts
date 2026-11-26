/**
 * The platform admin's view of money: one account's wallet and history, platform-wide lists, what is stuck or failing,
 * and the audit trail. Read by the admin console through /admin (admin-only at the gateway and in this service).
 *
 * Columns are always named: never SELECT * here (payments still carries a legacy stellar_source_secret column).
 */
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

const MAX_PAGE = 200;
const TX_HASH = /^[0-9a-f]{64}$/i;
const PAYMENT_STATUSES = ['initiated', 'submitted', 'completed', 'pending_claim', 'failed'];
const ESCROW_STATUSES = ['active', 'completed', 'refunded'];
const CASHOUT_STATUSES = ['pending', 'completed', 'failed'];

export interface ListQuery { status?: string; q?: string; limit?: string | number; offset?: string | number }

/** A page window from query-string values: at most 200 rows, defaulting to the first 50. */
export function pageOf(q: ListQuery): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), MAX_PAGE);
  const offset = Math.max(Number(q.offset) || 0, 0);
  return { limit, offset };
}

/** Builds a WHERE clause from optional conditions, numbering the parameters. */
function where(conds: Array<[string, unknown] | null>): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts = conds.filter((c): c is [string, unknown] => !!c).map(([clause, value]) => {
    params.push(value);
    return clause.replace('?', `$${params.length}`);
  });
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

const PAYMENT_COLUMNS = `p.id, p.enterprise_id, e.email AS enterprise_email, p.worker_id, w.email AS worker_email, p.amount,
  p.currency, p.status, p.failure_reason, p.stellar_tx_hash, p.batch_id, p.description, p.created_at, p.completed_at,
  p.failed_at, p.chain_verified_at`;

/**
 * Payments platform-wide, newest first. `q` finds a payment by its id or transaction hash, or everything to or from one
 * account by its id.
 */
export async function listPayments(q: ListQuery, deps: AdminViewDeps) {
  const { limit, offset } = pageOf(q);
  const term = q.q?.trim() ?? '';
  const w = where([
    q.status && PAYMENT_STATUSES.includes(q.status) ? ['p.status = ?', q.status] : null,
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
  const w = where([
    q.status && ESCROW_STATUSES.includes(q.status) ? ['x.status = ?', q.status] : null,
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
  const w = where([
    q.status && CASHOUT_STATUSES.includes(q.status) ? ['c.status = ?', q.status] : null,
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

/** The audit trail, newest first, narrowed by what it happened to, who did it, or the action. */
export async function listAudit(
  q: ListQuery & { entityType?: string; entityId?: string; actorId?: string; action?: string }, deps: AdminViewDeps,
) {
  const { limit, offset } = pageOf(q);
  const w = where([
    q.entityType ? ['entity_type = ?', q.entityType] : null,
    q.entityId ? ['entity_id = ?', q.entityId] : null,
    isUuid(q.actorId) ? ['actor_id = ?', q.actorId] : null,
    q.action ? ['action LIKE ?', `${escapeLike(q.action)}%`] : null,
  ]);
  const rows = await deps.query(
    `SELECT id, at, actor_id, actor_role, action, entity_type, entity_id, detail, request_id
       FROM audit_events ${w.sql} ORDER BY at DESC LIMIT ${limit} OFFSET ${offset}`,
    w.params,
  );
  return { events: rows.rows, limit, offset };
}
