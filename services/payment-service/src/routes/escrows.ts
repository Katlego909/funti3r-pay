import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { query } from '@funti3r/database';
import { createLogger, decryptFromString, parseBody } from '@funti3r/shared-utils';
import { resolveCompanyContextOrSelf, canMoveMoney, isCompanyWorker } from '../lib/company.js';
import * as escrow from '../lib/escrow.js';
import { recordEscrowPaymentSafely } from '../lib/escrowAccounting.js';
import { ComplianceBlockedError, ensureCleared, screenEmployer } from '../lib/clearance.js';
import { reconcileEscrows } from '../lib/escrowReconcile.js';
import { moneygramConfigured } from '../lib/moneygram.js';
import { requireCompliance, resolveEnterpriseSecret } from '../app.js';
import { createEscrowBody } from '../lib/schemas.js';

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
            approve_tx_hash, refund_tx_hash, review_status
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
      reviewStatus: m.review_status ?? 'none',
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

// ── POST /escrows — create + fund on-chain ────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const ctx = await requireCompanyWrite(req, res);
  if (!ctx) return;

  const body = parseBody(createEscrowBody, req.body, res);
  if (!body) return;
  const { workerId, milestones, expiresAt } = body;
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
    // the current KYC + sanctions verdict first. The funding company is screened too.
    await screenEmployer(ctx.ownerUserId);
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
    // The worker has now really received this money: put it in the books (Total Received, history).
    await recordEscrowPaymentSafely(id, idx);

    await notify(
      row.enterprise_id, 'escrow_milestone_claimed', 'Milestone claimed',
      `Your worker claimed milestone ${idx + 1} (${Number(ms.rows[0].amount)} XLM).`, id,
    );

    res.json({ txHash: hash });
  } catch (err) {
    logger.error('Failed to claim milestone', { id, idx, error: String(err) });
    sendChainError(res, err, 'Failed to claim on-chain');
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

// ── GET /escrows/cashout-options ──────────────────────────────────────────────
// Whether MoneyGram cash-out is configured on this deployment, so the UI only offers it when real.

router.get('/cashout-options', (_req: Request, res: Response) => {
  res.json({ moneygram: moneygramConfigured() });
});

// ── GET /escrows/summary ──────────────────────────────────────────────────────
// Escrow money in one place, in XLM (the contract's unit); the dashboards convert it
// to the viewer's display currency. Workers see their own, employers their company's.

router.get('/summary', async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string | undefined;
  const role = req.headers['x-user-role'] as string | undefined;
  if (!userId) return res.status(403).json({ error: 'Authentication required' });

  try {
    let column: 'e.enterprise_id' | 'e.worker_id';
    let scopeId = userId;
    if (role === 'enterprise') {
      const ctx = await requireCompanyRead(req, res);
      if (!ctx) return;
      column = 'e.enterprise_id';
      scopeId = ctx.ownerUserId;
    } else if (role === 'worker') {
      column = 'e.worker_id';
    } else {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const r = await query(
      `SELECT
         COALESCE(SUM(m.amount) FILTER (WHERE m.status IN ('pending', 'approved')), 0) AS locked,
         COALESCE(SUM(m.amount) FILTER (WHERE m.status = 'claimed'), 0) AS claimed,
         COALESCE(SUM(m.amount) FILTER (WHERE m.status = 'refunded'), 0) AS refunded
       FROM escrow_milestones m JOIN escrows e ON e.id = m.escrow_id
      WHERE ${column} = $1`,
      [scopeId],
    );
    const row = r.rows[0] ?? {};
    // Cash-outs (MoneyGram) come out of the worker's wallet; employers do not see them.
    const wallet = role === 'worker'
      ? Number((await query(
          `SELECT COALESCE(SUM(xlm_spent), 0) AS spent FROM cashouts WHERE worker_id = $1 AND status IN ('pending', 'completed')`,
          [userId],
        )).rows[0]?.spent ?? 0)
      : 0;
    res.json({
      lockedXlm: Number(row.locked ?? 0),
      claimedXlm: Number(row.claimed ?? 0),
      refundedXlm: Number(row.refunded ?? 0),
      cashedOutXlm: wallet,
    });
  } catch (err) {
    logger.error('Failed to summarize escrows', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
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
