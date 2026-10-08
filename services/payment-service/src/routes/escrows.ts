import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { query } from '@funti3r/database';
import { createLogger, decryptFromString } from '@funti3r/shared-utils';
import { resolveCompanyContextOrSelf, canMoveMoney, isCompanyWorker } from '../lib/company.js';
import * as escrow from '../lib/escrow.js';
import { ComplianceBlockedError, ensureCleared } from '../lib/clearance.js';
import { anchorConfigured, sendAnchorPayout } from '../rails/anchor.js';
import { reconcileEscrows } from '../lib/escrowReconcile.js';
import { AnchorActionRequiredError, AnchorAmountMismatchError, interactiveUrlUsable } from '../lib/anchor.js';
import { requireCompliance, resolveEnterpriseSecret } from '../app.js';

const router: RouterType = Router();
const logger = createLogger('EscrowsRoute');

// ── Auth guards (same shape as routes/schedules.ts) ───────────────────────────

interface EnterpriseCtx {
  ownerUserId: string;
  companyId: string | null;
}

async function requireCompanyRead(req: Request, res: Response): Promise<EnterpriseCtx | null> {
  const userId = req.headers['x-user-id'] as string | undefined;
  const role = req.headers['x-user-role'] as string | undefined;
  if (role !== 'enterprise' || !userId) {
    res.status(403).json({ error: 'Enterprise role required' });
    return null;
  }
  const ctx = (await resolveCompanyContextOrSelf(userId, role))!;
  return { ownerUserId: ctx.ownerUserId, companyId: ctx.companyId };
}

async function requireCompanyWrite(req: Request, res: Response): Promise<EnterpriseCtx | null> {
  const userId = req.headers['x-user-id'] as string | undefined;
  const role = req.headers['x-user-role'] as string | undefined;
  if (role !== 'enterprise' || !userId) {
    res.status(403).json({ error: 'Enterprise role required' });
    return null;
  }
  const ctx = (await resolveCompanyContextOrSelf(userId, role))!;
  if (!canMoveMoney(ctx.companyRole)) {
    res.status(403).json({ error: 'Only company owners and admins can manage escrows' });
    return null;
  }
  return { ownerUserId: ctx.ownerUserId, companyId: ctx.companyId };
}

function requireWorker(req: Request, res: Response): string | null {
  const userId = req.headers['x-user-id'] as string | undefined;
  const role = req.headers['x-user-role'] as string | undefined;
  if (role !== 'worker' || !userId) {
    res.status(403).json({ error: 'Worker role required' });
    return null;
  }
  return userId;
}

async function workerPublicKey(workerId: string): Promise<string | undefined> {
  const r = await query(`SELECT stellar_public_key FROM users WHERE id = $1`, [workerId]);
  return r.rows[0]?.stellar_public_key;
}

/**
 * Maps a failure to an HTTP response: compliance blocks (from the sync step or
 * from the contract's own gate) are 403, other contract-rule rejections are
 * 409, everything else is a 502 from the chain.
 */
function sendChainError(res: Response, err: unknown, fallback: string) {
  if (err instanceof ComplianceBlockedError) {
    return res.status(403).json({ error: err.message, code: 'compliance_blocked' });
  }
  if (err instanceof escrow.EscrowContractError) {
    return res.status(err.isComplianceBlock ? 403 : 409).json({
      error: err.message,
      code: err.isComplianceBlock ? 'compliance_blocked' : 'contract_rejected',
      contractCode: err.code,
    });
  }
  return res.status(502).json({ error: err instanceof Error ? err.message : fallback });
}

async function notify(userId: string, type: string, title: string, body: string, escrowId: string) {
  try {
    await query(
      `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, 'escrow', $5)`,
      [userId, type, title, body, escrowId],
    );
  } catch (err) {
    logger.warn('Failed to emit escrow notification', { escrowId, type, error: String(err) });
  }
}

// ── Milestone review trail ────────────────────────────────────────────────────

const MAX_NOTE = 2000;
const MAX_REASON = 1000;
const MAX_LINKS = 5;

/** Validates a worker's submission: an optional note plus up to 5 http(s) links, at least one of the two. */
export function parseSubmission(body: unknown): { note: string; links: string[] } | { error: string } {
  const b = (body ?? {}) as { note?: unknown; links?: unknown };
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > MAX_NOTE) return { error: `Note must be at most ${MAX_NOTE} characters` };

  const rawLinks = b.links === undefined ? [] : b.links;
  if (!Array.isArray(rawLinks)) return { error: 'links must be an array of URLs' };
  if (rawLinks.length > MAX_LINKS) return { error: `At most ${MAX_LINKS} links are allowed` };
  const links: string[] = [];
  for (const raw of rawLinks) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    let ok = false;
    try {
      const u = new URL(value);
      ok = (u.protocol === 'http:' || u.protocol === 'https:') && value.length <= 500;
    } catch { /* not a URL */ }
    if (!ok) return { error: `Not a valid http(s) link: ${String(raw).slice(0, 60)}` };
    links.push(value);
  }
  if (!note && links.length === 0) return { error: 'Add a note or at least one link describing the work' };
  return { note, links };
}

/** Appends to the audit trail. Never fails the request — the state change it describes already happened. */
async function recordReviewEvent(
  escrowId: string, idx: number, kind: 'submitted' | 'approved' | 'rejected',
  actorId: string | undefined, actorRole: 'worker' | 'enterprise', note: string | null, links: string[] = [],
) {
  try {
    await query(
      `INSERT INTO escrow_milestone_events (escrow_id, idx, kind, actor_id, actor_role, note, links)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [escrowId, idx, kind, actorId ?? null, actorRole, note, JSON.stringify(links)],
    );
  } catch (err) {
    logger.warn('Failed to record milestone review event', { escrowId, idx, kind, error: String(err) });
  }
}

async function listReviewEvents(escrowIds: string[]) {
  if (escrowIds.length === 0) return {} as Record<string, unknown[]>;
  const rows = await query(
    `SELECT escrow_id, idx, kind, actor_role, note, links, created_at
       FROM escrow_milestone_events WHERE escrow_id = ANY($1::uuid[]) ORDER BY created_at, id`,
    [escrowIds],
  );
  const byEscrow: Record<string, unknown[]> = {};
  for (const e of rows.rows) {
    (byEscrow[e.escrow_id] ??= []).push({
      idx: e.idx, kind: e.kind, by: e.actor_role, note: e.note ?? null, links: e.links ?? [], at: e.created_at,
    });
  }
  return byEscrow;
}

async function listMilestones(escrowIds: string[]) {
  if (escrowIds.length === 0) return {} as Record<string, unknown[]>;
  const rows = await query(
    `SELECT escrow_id, idx, description, amount, status, approved_at, claimed_at, claim_tx_hash,
            approve_tx_hash, refund_tx_hash, cashout_at, review_status,
            cashout_status, anchor_tx_id, anchor_settlement_hash, anchor_status, anchor_more_info_url, cashout_error
       FROM escrow_milestones WHERE escrow_id = ANY($1::uuid[]) ORDER BY idx`,
    [escrowIds],
  );
  const byEscrow: Record<string, unknown[]> = {};
  for (const m of rows.rows) {
    (byEscrow[m.escrow_id] ??= []).push({
      idx: m.idx,
      description: m.description,
      amountXlm: Number(m.amount),
      status: m.status,
      approvedAt: m.approved_at,
      claimedAt: m.claimed_at,
      claimTxHash: m.claim_tx_hash,
      approveTxHash: m.approve_tx_hash ?? null,
      refundTxHash: m.refund_tx_hash ?? null,
      cashoutAt: m.cashout_at ?? null,
      reviewStatus: m.review_status ?? 'none',
      cashoutStatus: m.cashout_status ?? 'none',
      anchorTxId: m.anchor_tx_id ?? null,
      anchorSettlementHash: m.anchor_settlement_hash ?? null,
      anchorStatus: m.anchor_status ?? null,
      anchorMoreInfoUrl: m.anchor_more_info_url ?? null,
      cashoutError: m.cashout_error ?? null,
    });
  }
  return byEscrow;
}

/** Reflect the contract's finalization rule into the DB row. */
async function finalizeEscrowStatus(escrowId: string): Promise<void> {
  await query(
    `UPDATE escrows e
        SET status = CASE
              WHEN EXISTS (SELECT 1 FROM escrow_milestones m
                            WHERE m.escrow_id = e.id AND m.status IN ('pending','approved')) THEN 'active'
              WHEN EXISTS (SELECT 1 FROM escrow_milestones m
                            WHERE m.escrow_id = e.id AND m.status = 'claimed') THEN 'completed'
              ELSE 'refunded'
            END,
            updated_at = NOW()
      WHERE e.id = $1`,
    [escrowId],
  );
}

// ── Anchor cash-out (second leg of a claim) ──────────────────────────────────

interface CashoutResult {
  status: 'completed' | 'failed' | 'action_required';
  anchorTxId?: string;
  settlementHash?: string;
  anchorStatus?: string;
  /** The anchor's own page the worker must visit (status = action_required). */
  moreInfoUrl?: string;
  error?: string;
}

/**
 * Routes an already-claimed milestone's funds from the worker's wallet through
 * the configured anchor. Never throws: a failure is recorded on the milestone
 * (retryable) because the claim itself already succeeded on-chain and the
 * funds are safe in the worker's wallet.
 *
 * Money safety:
 *  - the cash-out is taken atomically (none|failed|action_required -> pending),
 *    so a double-click or retry can't run two attempts at once;
 *  - the anchor transaction id and the on-chain settlement hash are persisted
 *    the instant they exist, and a retry resumes from them — an attempt that
 *    already paid the anchor is never paid a second time.
 */
async function cashOutMilestone(escrowId: string, idx: number, workerId: string): Promise<CashoutResult | 'in_progress'> {
  const taken = await query(
    `UPDATE escrow_milestones SET cashout_status = 'pending', cashout_error = NULL
      WHERE escrow_id = $1 AND idx = $2 AND status = 'claimed'
        AND cashout_status IN ('none', 'failed', 'action_required')
      RETURNING amount, anchor_tx_id, anchor_protocol, anchor_settlement_hash, anchor_more_info_url`,
    [escrowId, idx],
  );
  if (!taken.rows.length) return 'in_progress';
  const amountXlm = String(Number(taken.rows[0].amount));
  const priorAnchorTxId: string | null = taken.rows[0].anchor_tx_id ?? null;
  const priorSettlementHash: string | null = taken.rows[0].anchor_settlement_hash ?? null;
  const priorInteractiveUrl: string | undefined = taken.rows[0].anchor_more_info_url ?? undefined;
  const priorProtocol: 'sep6' | 'sep24' = taken.rows[0].anchor_protocol === 'sep24' ? 'sep24' : 'sep6';

  // A parked SEP-24 cash-out whose form link is unusable (status page or
  // expired token) can't be completed: start a fresh anchor transaction. Only
  // while nothing was paid — a settlement hash always resumes, never restarts.
  const abandonPriorAnchorTx = !!priorAnchorTxId && !priorSettlementHash
    && priorProtocol === 'sep24' && !interactiveUrlUsable(priorInteractiveUrl);

  try {
    if (!anchorConfigured()) throw new Error('No disbursement anchor is configured');
    const w = await query(`SELECT stellar_secret_key, payout_details FROM users WHERE id = $1`, [workerId]);
    const row = w.rows[0];
    if (!row?.stellar_secret_key) throw new Error('Worker Stellar account is not set up');

    const result = await sendAnchorPayout({
      payerSecret: decryptFromString(row.stellar_secret_key),
      amountXlm,
      kyc: row.payout_details ?? {},
      resume: priorAnchorTxId && !abandonPriorAnchorTx
        ? { anchorTxId: priorAnchorTxId, protocol: priorProtocol, settlementHash: priorSettlementHash ?? undefined, interactiveUrl: priorInteractiveUrl }
        : undefined,
      onWithdrawCreated: async (anchorTxId, protocol, interactiveUrl) => {
        await query(
          `UPDATE escrow_milestones SET anchor_tx_id = $3, anchor_protocol = $4, anchor_more_info_url = $5
            WHERE escrow_id = $1 AND idx = $2`,
          [escrowId, idx, anchorTxId, protocol, interactiveUrl ?? null],
        );
      },
      onSettled: async (settlementHash) => {
        await query(
          `UPDATE escrow_milestones SET anchor_settlement_hash = $3 WHERE escrow_id = $1 AND idx = $2`,
          [escrowId, idx, settlementHash],
        );
      },
    });
    await query(
      `UPDATE escrow_milestones
          SET cashout_status = 'completed', anchor_tx_id = $3, anchor_settlement_hash = $4,
              anchor_status = $5, anchor_more_info_url = NULL, cashout_at = NOW()
        WHERE escrow_id = $1 AND idx = $2`,
      [escrowId, idx, result.anchorTxId, result.settlementHash, result.anchorStatus],
    );
    return {
      status: 'completed',
      anchorTxId: result.anchorTxId,
      settlementHash: result.settlementHash,
      anchorStatus: result.anchorStatus,
    };
  } catch (err) {
    if (err instanceof AnchorActionRequiredError) {
      // Not a failure: the anchor wants the worker to finish a step on its own
      // site. Park the cash-out; the same anchor transaction resumes on retry.
      await query(
        `UPDATE escrow_milestones
            SET cashout_status = 'action_required', anchor_tx_id = $3, anchor_more_info_url = $4
          WHERE escrow_id = $1 AND idx = $2`,
        [escrowId, idx, err.anchorTxId, err.moreInfoUrl],
      );
      return { status: 'action_required', anchorTxId: err.anchorTxId, moreInfoUrl: err.moreInfoUrl };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof AnchorAmountMismatchError) {
      // That anchor transaction is unusable (nothing was sent): forget it so the
      // retry starts a fresh one instead of resuming the wrong-amount one.
      await query(
        `UPDATE escrow_milestones
            SET anchor_tx_id = NULL, anchor_protocol = NULL, anchor_more_info_url = NULL
          WHERE escrow_id = $1 AND idx = $2 AND anchor_settlement_hash IS NULL`,
        [escrowId, idx],
      );
    }
    logger.error('Anchor cash-out failed', { escrowId, idx, error: message });
    await query(
      `UPDATE escrow_milestones SET cashout_status = 'failed', cashout_error = $3 WHERE escrow_id = $1 AND idx = $2`,
      [escrowId, idx, message.slice(0, 500)],
    );
    return { status: 'failed', error: message };
  }
}

// ── POST /escrows — create + fund on-chain ────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const ctx = await requireCompanyWrite(req, res);
  if (!ctx) return;

  const { workerId, milestones, expiresAt } = req.body as {
    workerId?: string;
    milestones?: Array<{ description?: string; amountXlm?: number | string }>;
    expiresAt?: string;
  };

  if (!workerId) return res.status(400).json({ error: 'workerId is required' });
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return res.status(400).json({ error: 'milestones must be a non-empty array' });
  }
  for (const m of milestones) {
    if (!m.amountXlm || Number(m.amountXlm) <= 0) {
      return res.status(400).json({ error: 'Each milestone requires a positive amountXlm' });
    }
  }
  const expiry = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : NaN;
  if (!Number.isFinite(expiry) || expiry * 1000 <= Date.now()) {
    return res.status(400).json({ error: 'expiresAt must be a valid future date' });
  }

  try {
    // Worker must exist, hold a Stellar account, and — when the company is
    // formalized — belong to it. Same KYC gate as payouts.
    const workerRes = await query(
      `SELECT stellar_public_key, email FROM users WHERE id = $1 AND role = 'worker'`,
      [workerId],
    );
    const worker = workerRes.rows[0];
    if (!worker?.stellar_public_key) {
      return res.status(404).json({ error: 'Worker Stellar account not found' });
    }
    if (ctx.companyId && !(await isCompanyWorker(ctx.companyId, workerId))) {
      return res.status(403).json({ error: 'Worker is not part of your team' });
    }
    try {
      await requireCompliance(workerId);
    } catch (err) {
      return res.status(403).json({ error: err instanceof Error ? err.message : String(err) });
    }

    // The contract enforces the gate; this brings its clearance in line with
    // the current KYC + sanctions verdict first.
    await ensureCleared(workerId, worker.stellar_public_key);

    const { secret, error } = await resolveEnterpriseSecret(ctx.ownerUserId);
    if (!secret) return res.status(400).json({ error });

    const amounts = milestones.map((m) => String(m.amountXlm));
    const { escrowId: onchainId, hash } = await escrow.createEscrow(
      secret,
      worker.stellar_public_key,
      amounts,
      expiry,
    );

    const total = amounts.reduce((s, a) => s + Number(a), 0);
    const ins = await query<{ id: string }>(
      `INSERT INTO escrows (enterprise_id, worker_id, contract_address, onchain_escrow_id,
                            token_code, total_amount, status, expires_at, create_tx_hash)
       VALUES ($1, $2, $3, $4, 'XLM', $5, 'active', $6, $7)
       RETURNING id`,
      [
        ctx.ownerUserId, workerId, process.env.ESCROW_CONTRACT_ADDRESS,
        onchainId.toString(), total, new Date(expiry * 1000).toISOString(), hash,
      ],
    );
    const id = ins.rows[0].id;

    const values: unknown[] = [];
    const placeholders = milestones.map((m, i) => {
      values.push(id, i, m.description ?? null, String(m.amountXlm));
      const base = i * 4;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });
    await query(
      `INSERT INTO escrow_milestones (escrow_id, idx, description, amount) VALUES ${placeholders.join(', ')}`,
      values,
    );

    await notify(
      workerId, 'escrow_created', 'New milestone escrow',
      `Your employer locked ${total} XLM across ${milestones.length} milestone(s) for you.`, id,
    );

    logger.info('Escrow created', { id, onchainId: onchainId.toString(), hash, total });
    res.status(201).json({ id, onchainEscrowId: onchainId.toString(), txHash: hash });
  } catch (err) {
    logger.error('Failed to create escrow', { error: String(err) });
    sendChainError(res, err, 'Failed to create escrow on-chain');
  }
});

// ── POST /escrows/:id/milestones/:idx/approve ─────────────────────────────────

router.post('/:id/milestones/:idx/approve', async (req: Request, res: Response) => {
  const ctx = await requireCompanyWrite(req, res);
  if (!ctx) return;
  const { id } = req.params;
  const idx = Number(req.params.idx);

  try {
    const escrowRes = await query(
      `SELECT id, worker_id, onchain_escrow_id, status FROM escrows WHERE id = $1 AND enterprise_id = $2`,
      [id, ctx.ownerUserId],
    );
    const row = escrowRes.rows[0];
    if (!row) return res.status(404).json({ error: 'Escrow not found' });
    if (row.status !== 'active') return res.status(409).json({ error: 'Escrow is no longer active' });

    const ms = await query(
      `SELECT status, amount FROM escrow_milestones WHERE escrow_id = $1 AND idx = $2`,
      [id, idx],
    );
    if (!ms.rows.length) return res.status(404).json({ error: 'Milestone not found' });
    if (ms.rows[0].status !== 'pending') {
      return res.status(409).json({ error: `Milestone is ${ms.rows[0].status}, not pending` });
    }

    const workerPub = await workerPublicKey(row.worker_id);
    if (!workerPub) return res.status(404).json({ error: 'Worker Stellar account not found' });
    await ensureCleared(row.worker_id, workerPub);

    const { secret, error } = await resolveEnterpriseSecret(ctx.ownerUserId);
    if (!secret) return res.status(400).json({ error });

    const hash = await escrow.approveMilestone(secret, BigInt(row.onchain_escrow_id), idx);
    await query(
      `UPDATE escrow_milestones SET status = 'approved', approved_at = NOW(), approve_tx_hash = $3
        WHERE escrow_id = $1 AND idx = $2`,
      [id, idx, hash],
    );

    const approveNote = typeof (req.body as { note?: unknown } | undefined)?.note === 'string'
      ? (req.body as { note: string }).note.trim().slice(0, MAX_REASON) || null
      : null;
    await recordReviewEvent(id, idx, 'approved', req.headers['x-user-id'] as string | undefined, 'enterprise', approveNote);

    await notify(
      row.worker_id, 'escrow_milestone_approved', 'Milestone approved',
      `Milestone ${idx + 1} (${Number(ms.rows[0].amount)} XLM) is approved — claim it from your wallet.`, id,
    );

    res.json({ txHash: hash });
  } catch (err) {
    logger.error('Failed to approve milestone', { id, idx, error: String(err) });
    sendChainError(res, err, 'Failed to approve on-chain');
  }
});

// ── POST /escrows/:id/milestones/:idx/submit (worker) ─────────────────────────
// "The work is done": a note and/or links for the employer to review. Off-chain
// only — the contract's moment is the employer's approval.

router.post('/:id/milestones/:idx/submit', async (req: Request, res: Response) => {
  const workerId = requireWorker(req, res);
  if (!workerId) return;
  const { id } = req.params;
  const idx = Number(req.params.idx);

  const parsed = parseSubmission(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });

  try {
    const found = await query(
      `SELECT e.enterprise_id, e.status AS escrow_status, m.status, m.review_status
         FROM escrows e JOIN escrow_milestones m ON m.escrow_id = e.id
        WHERE e.id = $1 AND e.worker_id = $2 AND m.idx = $3`,
      [id, workerId, idx],
    );
    const row = found.rows[0];
    if (!row) return res.status(404).json({ error: 'Milestone not found' });
    if (row.escrow_status !== 'active') return res.status(409).json({ error: 'Escrow is no longer active' });
    if (row.status !== 'pending') {
      return res.status(409).json({ error: `Milestone is ${row.status} — there is nothing left to submit` });
    }
    if (row.review_status === 'submitted') {
      return res.status(409).json({ error: 'Already submitted — waiting for the employer to review it' });
    }

    // Guarded so a double-click can't record the same submission twice.
    const taken = await query(
      `UPDATE escrow_milestones SET review_status = 'submitted'
        WHERE escrow_id = $1 AND idx = $2 AND status = 'pending' AND review_status <> 'submitted'
        RETURNING idx`,
      [id, idx],
    );
    if (!taken.rows.length) {
      return res.status(409).json({ error: 'Already submitted — waiting for the employer to review it' });
    }

    await recordReviewEvent(id, idx, 'submitted', workerId, 'worker', parsed.note || null, parsed.links);
    await notify(
      row.enterprise_id, 'escrow_work_submitted', 'Work submitted for review',
      `Your worker submitted milestone ${idx + 1} for review.`, id,
    );
    res.json({ reviewStatus: 'submitted' });
  } catch (err) {
    logger.error('Failed to submit milestone work', { id, idx, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /escrows/:id/milestones/:idx/reject (enterprise) ─────────────────────
// Sends submitted work back with a reason; the worker can resubmit. Nothing
// on-chain changes — the milestone simply stays Pending.

router.post('/:id/milestones/:idx/reject', async (req: Request, res: Response) => {
  const ctx = await requireCompanyWrite(req, res);
  if (!ctx) return;
  const { id } = req.params;
  const idx = Number(req.params.idx);

  const reason = typeof (req.body as { reason?: unknown } | undefined)?.reason === 'string'
    ? (req.body as { reason: string }).reason.trim()
    : '';
  if (!reason) return res.status(400).json({ error: 'A reason is required so the worker knows what to change' });
  if (reason.length > MAX_REASON) return res.status(400).json({ error: `Reason must be at most ${MAX_REASON} characters` });

  try {
    const found = await query(
      `SELECT e.worker_id, e.status AS escrow_status, m.status, m.review_status
         FROM escrows e JOIN escrow_milestones m ON m.escrow_id = e.id
        WHERE e.id = $1 AND e.enterprise_id = $2 AND m.idx = $3`,
      [id, ctx.ownerUserId, idx],
    );
    const row = found.rows[0];
    if (!row) return res.status(404).json({ error: 'Milestone not found' });
    if (row.escrow_status !== 'active') return res.status(409).json({ error: 'Escrow is no longer active' });
    if (row.status !== 'pending') {
      return res.status(409).json({ error: `Milestone is ${row.status} — only pending milestones can be sent back` });
    }
    if (row.review_status !== 'submitted') {
      return res.status(409).json({ error: 'The worker has not submitted this milestone for review' });
    }

    const taken = await query(
      `UPDATE escrow_milestones SET review_status = 'rejected'
        WHERE escrow_id = $1 AND idx = $2 AND status = 'pending' AND review_status = 'submitted'
        RETURNING idx`,
      [id, idx],
    );
    if (!taken.rows.length) {
      return res.status(409).json({ error: 'This submission was already reviewed' });
    }

    await recordReviewEvent(id, idx, 'rejected', req.headers['x-user-id'] as string | undefined, 'enterprise', reason);
    await notify(
      row.worker_id, 'escrow_work_rejected', 'Changes requested',
      `Milestone ${idx + 1} was sent back: ${reason.slice(0, 140)}`, id,
    );
    res.json({ reviewStatus: 'rejected' });
  } catch (err) {
    logger.error('Failed to reject milestone', { id, idx, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /escrows/:id/milestones/:idx/claim (worker) ─────────────────────────

router.post('/:id/milestones/:idx/claim', async (req: Request, res: Response) => {
  const workerId = requireWorker(req, res);
  if (!workerId) return;
  const { id } = req.params;
  const idx = Number(req.params.idx);
  const wantsAnchorCashout = (req.body as { cashout?: string } | undefined)?.cashout === 'anchor';
  if (wantsAnchorCashout && !anchorConfigured()) {
    return res.status(400).json({ error: 'Anchor cash-out is not available — no anchor is configured' });
  }

  try {
    const escrowRes = await query(
      `SELECT id, enterprise_id, onchain_escrow_id, status FROM escrows WHERE id = $1 AND worker_id = $2`,
      [id, workerId],
    );
    const row = escrowRes.rows[0];
    if (!row) return res.status(404).json({ error: 'Escrow not found' });

    const ms = await query(
      `SELECT status, amount FROM escrow_milestones WHERE escrow_id = $1 AND idx = $2`,
      [id, idx],
    );
    if (!ms.rows.length) return res.status(404).json({ error: 'Milestone not found' });
    if (ms.rows[0].status !== 'approved') {
      return res.status(409).json({ error: `Milestone is ${ms.rows[0].status} — only approved milestones can be claimed` });
    }

    const secretRes = await query(`SELECT stellar_secret_key FROM users WHERE id = $1`, [workerId]);
    const stored = secretRes.rows[0]?.stellar_secret_key;
    if (!stored) return res.status(400).json({ error: 'Your Stellar account is not set up for claiming' });

    // Re-screen at release time: a worker flagged since approval is revoked
    // on-chain here, before the claim can move any funds.
    const claimerPub = await workerPublicKey(workerId);
    if (!claimerPub) return res.status(400).json({ error: 'Your Stellar account is not set up for claiming' });
    await ensureCleared(workerId, claimerPub);

    const hash = await escrow.claimMilestone(decryptFromString(stored), BigInt(row.onchain_escrow_id), idx);
    await query(
      `UPDATE escrow_milestones SET status = 'claimed', claimed_at = NOW(), claim_tx_hash = $3
        WHERE escrow_id = $1 AND idx = $2`,
      [id, idx, hash],
    );
    await finalizeEscrowStatus(id);

    await notify(
      row.enterprise_id, 'escrow_milestone_claimed', 'Milestone claimed',
      `Your worker claimed milestone ${idx + 1} (${Number(ms.rows[0].amount)} XLM).`, id,
    );

    // Claim and cash-out are separate legs: a failed anchor never undoes the
    // claim, it just leaves a retryable cash-out.
    const cashout = wantsAnchorCashout ? await cashOutMilestone(id, idx, workerId) : undefined;
    res.json({ txHash: hash, ...(cashout && { cashout }) });
  } catch (err) {
    logger.error('Failed to claim milestone', { id, idx, error: String(err) });
    sendChainError(res, err, 'Failed to claim on-chain');
  }
});

// ── POST /escrows/:id/milestones/:idx/cashout (worker) ───────────────────────
// Cash out an already-claimed milestone through the anchor: either the
// "claim now, cash out later" path or a retry after a failed anchor leg.

router.post('/:id/milestones/:idx/cashout', async (req: Request, res: Response) => {
  const workerId = requireWorker(req, res);
  if (!workerId) return;
  const { id } = req.params;
  const idx = Number(req.params.idx);
  if (!anchorConfigured()) {
    return res.status(400).json({ error: 'Anchor cash-out is not available — no anchor is configured' });
  }

  try {
    const owned = await query(
      `SELECT m.status, m.cashout_status
         FROM escrow_milestones m JOIN escrows e ON e.id = m.escrow_id
        WHERE m.escrow_id = $1 AND m.idx = $2 AND e.worker_id = $3`,
      [id, idx, workerId],
    );
    const m = owned.rows[0];
    if (!m) return res.status(404).json({ error: 'Milestone not found' });
    if (m.status !== 'claimed') {
      return res.status(409).json({ error: `Milestone is ${m.status} — claim it before cashing out` });
    }

    // Re-screen before money leaves the platform for a bank/cash destination.
    const pub = await workerPublicKey(workerId);
    if (!pub) return res.status(400).json({ error: 'Your Stellar account is not set up' });
    await ensureCleared(workerId, pub);

    const result = await cashOutMilestone(id, idx, workerId);
    if (result === 'in_progress') {
      return res.status(409).json({ error: `Cash-out is already ${m.cashout_status}` });
    }
    res.status(result.status === 'failed' ? 502 : 200).json({ cashout: result });
  } catch (err) {
    logger.error('Failed to cash out milestone', { id, idx, error: String(err) });
    sendChainError(res, err, 'Failed to cash out milestone');
  }
});

// ── POST /escrows/:id/freeze (compliance admin) ───────────────────────────────
// Compliance hold: while frozen the contract blocks approve, claim and refund
// for this escrow. Admin-only — same role gate as the KYC flagged list.

router.post('/:id/freeze', async (req: Request, res: Response) => {
  if (req.headers['x-user-role'] !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { id } = req.params;
  const frozen = (req.body as { frozen?: unknown })?.frozen;
  if (typeof frozen !== 'boolean') return res.status(400).json({ error: 'frozen (boolean) is required' });

  try {
    const r = await query(`SELECT onchain_escrow_id FROM escrows WHERE id = $1`, [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Escrow not found' });

    const hash = await escrow.setFrozen(BigInt(r.rows[0].onchain_escrow_id), frozen);
    await query(`UPDATE escrows SET frozen = $2, updated_at = NOW() WHERE id = $1`, [id, frozen]);
    logger.warn('Escrow freeze changed', { id, frozen, hash, by: req.headers['x-user-id'] });
    res.json({ frozen, txHash: hash });
  } catch (err) {
    logger.error('Failed to change escrow freeze', { id, error: String(err) });
    sendChainError(res, err, 'Failed to change freeze on-chain');
  }
});

// ── POST /escrows/reconcile (admin) ───────────────────────────────────────────
// Compare every active escrow with the chain and repair the database to match.
// { "repair": false } is a dry run that only reports the drift.

router.post('/reconcile', async (req: Request, res: Response) => {
  if (req.headers['x-user-role'] !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  try {
    const repair = (req.body as { repair?: unknown } | undefined)?.repair !== false;
    const report = await reconcileEscrows({ repair });
    logger.info('Manual escrow reconcile', { by: req.headers['x-user-id'], repair, ...report });
    res.json({ repair, ...report });
  } catch (err) {
    logger.error('Escrow reconcile failed', { error: String(err) });
    res.status(502).json({ error: err instanceof Error ? err.message : 'Reconcile failed' });
  }
});

// ── POST /escrows/:id/refund ──────────────────────────────────────────────────

router.post('/:id/refund', async (req: Request, res: Response) => {
  const ctx = await requireCompanyWrite(req, res);
  if (!ctx) return;
  const { id } = req.params;

  try {
    const escrowRes = await query(
      `SELECT id, worker_id, onchain_escrow_id, status, expires_at FROM escrows
        WHERE id = $1 AND enterprise_id = $2`,
      [id, ctx.ownerUserId],
    );
    const row = escrowRes.rows[0];
    if (!row) return res.status(404).json({ error: 'Escrow not found' });
    if (row.status !== 'active') return res.status(409).json({ error: 'Escrow is no longer active' });
    if (new Date(row.expires_at) > new Date()) {
      return res.status(400).json({ error: 'Escrow has not expired yet — refunds unlock after the expiry date' });
    }

    const { secret, error } = await resolveEnterpriseSecret(ctx.ownerUserId);
    if (!secret) return res.status(400).json({ error });

    const { refundedStroops, hash } = await escrow.refundEscrow(secret, BigInt(row.onchain_escrow_id));
    await query(
      `UPDATE escrow_milestones SET status = 'refunded', refund_tx_hash = $2
        WHERE escrow_id = $1 AND status = 'pending'`,
      [id, hash],
    );
    await finalizeEscrowStatus(id);

    res.json({ refundedXlm: Number(refundedStroops) / 1e7, txHash: hash });
  } catch (err) {
    logger.error('Failed to refund escrow', { id, error: String(err) });
    sendChainError(res, err, 'Failed to refund on-chain');
  }
});

// ── GET /escrows — enterprise (company-scoped) or worker (own) ────────────────

router.get('/', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string | undefined;
  const role = req.headers['x-user-role'] as string | undefined;
  if (!userId) return res.status(403).json({ error: 'Authentication required' });

  try {
    let rows;
    if (role === 'enterprise') {
      const ctx = await requireCompanyRead(req, res);
      if (!ctx) return;
      rows = await query(
        `SELECT e.*, u.email AS worker_email FROM escrows e
           JOIN users u ON u.id = e.worker_id
          WHERE e.enterprise_id = $1 ORDER BY e.created_at DESC`,
        [ctx.ownerUserId],
      );
    } else {
      rows = await query(
        `SELECT e.*, u.email AS worker_email FROM escrows e
           JOIN users u ON u.id = e.worker_id
          WHERE e.worker_id = $1 ORDER BY e.created_at DESC`,
        [userId],
      );
    }

    const escrowIds = rows.rows.map((r) => r.id);
    const milestones = await listMilestones(escrowIds);
    const reviewEvents = await listReviewEvents(escrowIds);
    res.json({
      escrows: rows.rows.map((r) => ({
        id: r.id,
        workerId: r.worker_id,
        workerEmail: r.worker_email,
        onchainEscrowId: r.onchain_escrow_id,
        contractAddress: r.contract_address,
        tokenCode: r.token_code,
        totalXlm: Number(r.total_amount),
        status: r.status,
        frozen: r.frozen === true,
        expiresAt: r.expires_at,
        createTxHash: r.create_tx_hash,
        createdAt: r.created_at,
        milestones: milestones[r.id] ?? [],
        reviewEvents: reviewEvents[r.id] ?? [],
      })),
    });
  } catch (err) {
    logger.error('Failed to list escrows', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
