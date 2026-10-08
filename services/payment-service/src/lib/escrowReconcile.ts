/**
 * Chain -> database reconciliation for escrows.
 *
 * The escrow contract is the source of truth; the escrows / escrow_milestones
 * tables mirror it. Every route does the on-chain call first and the database
 * write second, so a crash, a restart or a failed write between the two leaves
 * the mirror behind (e.g. a milestone shown as "approved" that is already
 * claimed). This compares each active escrow with `get_escrow` and repairs the
 * database to match the chain — never the other way round.
 *
 * Safe to run at any time: repairs are idempotent and compatible with the
 * route writes that may be in flight (those set the same status plus the tx
 * hash). An RPC error leaves that escrow untouched.
 */
import { query } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';
import { complianceAuthorityPublic, getEscrow, type OnchainEscrow } from './escrow.js';
import { recordEscrowPaymentSafely } from './escrowAccounting.js';

const logger = createLogger('EscrowReconcile');

const MILESTONE_STATUS: Record<string, string> = {
  Pending: 'pending',
  Approved: 'approved',
  Claimed: 'claimed',
  Refunded: 'refunded',
};
const ESCROW_STATUS: Record<string, string> = {
  Active: 'active',
  Completed: 'completed',
  Refunded: 'refunded',
};

export interface EscrowDrift {
  escrowId: string;
  onchainId: string;
  /** `status`, `frozen`, `milestone[n].status` or `milestones.length`. */
  field: string;
  db: string;
  chain: string;
}

export interface ReconcileReport {
  checked: number;
  /** Escrows whose database rows were changed to match the chain. */
  repaired: number;
  /** Escrows that could not be read from the chain (left untouched). */
  unreadable: number;
  drift: EscrowDrift[];
}

interface DbEscrow {
  id: string;
  onchain_escrow_id: string;
  status: string;
  frozen: boolean;
}

interface DbMilestone {
  idx: number;
  status: string;
}

/** Pure comparison: what differs between a database escrow and its on-chain state. */
export function diffEscrow(
  db: DbEscrow,
  dbMilestones: DbMilestone[],
  chain: OnchainEscrow,
): EscrowDrift[] {
  const base = { escrowId: db.id, onchainId: String(db.onchain_escrow_id) };
  const drift: EscrowDrift[] = [];

  if (dbMilestones.length !== chain.milestones.length) {
    // Structural mismatch can't be repaired by flipping a status — report only.
    return [{ ...base, field: 'milestones.length', db: String(dbMilestones.length), chain: String(chain.milestones.length) }];
  }

  const chainStatus = ESCROW_STATUS[chain.status] ?? chain.status.toLowerCase();
  if (db.status !== chainStatus) drift.push({ ...base, field: 'status', db: db.status, chain: chainStatus });
  if (!!db.frozen !== chain.frozen) drift.push({ ...base, field: 'frozen', db: String(!!db.frozen), chain: String(chain.frozen) });

  for (const m of dbMilestones) {
    const onchain = MILESTONE_STATUS[chain.milestones[m.idx]] ?? String(chain.milestones[m.idx]).toLowerCase();
    if (m.status !== onchain) drift.push({ ...base, field: `milestone[${m.idx}].status`, db: m.status, chain: onchain });
  }
  return drift;
}

async function repair(chain: OnchainEscrow, drift: EscrowDrift[]): Promise<void> {
  const escrowId = drift[0].escrowId;

  for (const d of drift) {
    const m = /^milestone\[(\d+)\]\.status$/.exec(d.field);
    if (!m) continue;
    const idx = Number(m[1]);
    // Timestamps are only back-filled when missing; the tx hash of a repaired
    // step is unknown here, so it stays NULL ("Not recorded" in the UI).
    await query(
      `UPDATE escrow_milestones
          SET status = $3,
              approved_at = CASE WHEN $3 IN ('approved', 'claimed') AND approved_at IS NULL THEN NOW() ELSE approved_at END,
              claimed_at  = CASE WHEN $3 = 'claimed' AND claimed_at IS NULL THEN NOW() ELSE claimed_at END
        WHERE escrow_id = $1 AND idx = $2 AND status <> $3`,
      [escrowId, idx, d.chain],
    );
    // A claim whose DB write was lost must still count as money the worker received.
    if (d.chain === 'claimed') await recordEscrowPaymentSafely(escrowId, idx);
  }

  if (drift.some((d) => d.field === 'status' || d.field === 'frozen')) {
    await query(
      `UPDATE escrows SET status = $2, frozen = $3, updated_at = NOW() WHERE id = $1`,
      [escrowId, ESCROW_STATUS[chain.status] ?? chain.status.toLowerCase(), chain.frozen],
    );
  }
}

/**
 * Compare every active escrow on the current contract with the chain.
 * `repair: false` is a dry run that only reports.
 */
export async function reconcileEscrows(opts: { repair?: boolean } = {}): Promise<ReconcileReport> {
  const shouldRepair = opts.repair !== false;
  const contract = process.env.ESCROW_CONTRACT_ADDRESS;
  const report: ReconcileReport = { checked: 0, repaired: 0, unreadable: 0, drift: [] };
  if (!contract) return report;

  const escrows = await query<DbEscrow>(
    `SELECT id, onchain_escrow_id, status, frozen FROM escrows
      WHERE contract_address = $1 AND status = 'active'`,
    [contract],
  );
  if (!escrows.rows.length) return report;

  const source = complianceAuthorityPublic();

  for (const e of escrows.rows) {
    report.checked++;
    let chain: OnchainEscrow;
    try {
      chain = await getEscrow(BigInt(e.onchain_escrow_id), source);
    } catch (err) {
      report.unreadable++;
      logger.warn('Could not read escrow from chain — left untouched', { escrowId: e.id, error: String(err) });
      continue;
    }

    const milestones = await query<DbMilestone>(
      `SELECT idx, status FROM escrow_milestones WHERE escrow_id = $1 ORDER BY idx`,
      [e.id],
    );
    const drift = diffEscrow(e, milestones.rows, chain);
    if (!drift.length) continue;

    report.drift.push(...drift);
    logger.warn('Escrow drifted from chain', { escrowId: e.id, onchainId: e.onchain_escrow_id, drift });
    // A structural mismatch (milestone count) is reported, never "repaired".
    if (shouldRepair && !drift.some((d) => d.field === 'milestones.length')) {
      await repair(chain, drift);
      report.repaired++;
    }
  }
  return report;
}
