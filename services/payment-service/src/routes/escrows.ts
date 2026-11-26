import { Router, Request, Response, NextFunction } from 'express';
import type { Router as RouterType } from 'express';
import { query, notify, recoveryHold } from '@funti3r/database';
import { AppError, createLogger, decryptFromString, ExternalServiceError, parseBody } from '@funti3r/shared-utils';
import { audit } from '../lib/audit.js';
import { resolveCompanyContextOrSelf, canMoveMoney, isCompanyWorker, NOT_ON_TEAM } from '../lib/company.js';
import * as escrow from '../lib/escrow.js';
import { recordEscrowPaymentSafely } from '../lib/escrowAccounting.js';
import { ensureCleared, screenEmployer } from '../lib/clearance.js';
import { reconcileEscrows } from '../lib/escrowReconcile.js';
import { moneygramConfigured } from '../lib/moneygram.js';
import { requireCompliance, resolveEnterpriseSecret } from '../app.js';
import { createEscrowBody } from '../lib/schemas.js';
import { beginEscrowCreation, completeEscrowCreation, failEscrowCreation, recordCreationIntent } from '../lib/escrowCreation.js';
import { SubmitOutcomeUnknownError, ensureAssetBalance, ensureTrustline } from '../lib/stellar.js';
import { fromStroops, toStroops } from '../lib/amounts.js';

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

const notifyEscrow = (userId: string, type: string, title: string, body: string, escrowId: string) =>
  notify({ userId, type, title, body, entityType: 'escrow', entityId: escrowId });

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
      amount: Number(m.amount),
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

router.post('/', recoveryHold(), async (req: Request, res: Response, next: NextFunction) => {
  const ctx = await requireCompanyWrite(req, res);
  if (!ctx) return;

  const body = parseBody(createEscrowBody, req.body, res);
  if (!body) return;
  const { workerId, milestones, expiresAt, idempotencyKey } = body;
  const expiry = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : NaN;
  if (!Number.isFinite(expiry) || expiry * 1000 <= Date.now()) {
    return res.status(400).json({ error: 'expiresAt must be a valid future date' });
  }

  try {
    // Worker must exist, hold a Stellar account and belong to the company. Same KYC gate as payouts.
    const workerRes = await query(
      `SELECT stellar_public_key, stellar_secret_key, email FROM users WHERE id = $1 AND role = 'worker' AND status IS DISTINCT FROM 'closed'`,
      [workerId],
    );
    const worker = workerRes.rows[0];
    if (!worker?.stellar_public_key) {
      return res.status(404).json({ error: 'Worker Stellar account not found' });
    }
    if (!(await isCompanyWorker(ctx.companyId, workerId))) {
      return res.status(403).json({ error: NOT_ON_TEAM });
    }
    // Amounts are in the escrow's token: USDC, so a milestone is simply its dollar value.
    const token = escrow.escrowToken();
    const specs = milestones.map((m) => ({ description: m.description, amount: m.amount }));
    const total = fromStroops(specs.reduce((sum, m) => sum + toStroops(m.amount), 0n));
    const begun = await beginEscrowCreation({
      enterpriseId: ctx.ownerUserId, workerId, tokenCode: token.code, milestones: specs, expiresAt: new Date(expiry * 1000), idempotencyKey,
    });
    if (begun.kind === 'mismatch') return res.status(422).json({ error: 'Idempotency key already used for a different escrow' });
    if (begun.kind === 'in_progress') return res.status(409).json({ error: 'This escrow is already being created' });
    if (begun.kind === 'done') {
      return res.status(201).json({ id: begun.escrowId, onchainEscrowId: begun.onchainEscrowId, txHash: begun.txHash, replayed: true });
    }

    let onchainId: bigint;
    let hash: string;
    try {
      await requireCompliance(workerId);
      // The contract enforces the gate; this brings its clearance in line with
      // the current KYC + sanctions verdict first. The funding company is screened too.
      await screenEmployer(ctx.ownerUserId);
      await ensureCleared(workerId, worker.stellar_public_key);

      const { secret, error } = await resolveEnterpriseSecret(ctx.ownerUserId);
      if (!secret) throw new AppError(400, error ?? 'Enterprise Stellar account is not set up');

      // The worker must be able to receive the token when they claim; checked now, before any money is locked.
      if (worker.stellar_secret_key) {
        await ensureTrustline(decryptFromString(worker.stellar_secret_key), token.code, token.issuer);
      }
      // The company wallet holds XLM: buy any USDC it is short of first. If that cannot be confirmed, nothing has been
      // locked yet, so it is a plain failure the employer can retry (any USDC bought simply stays in their wallet).
      try {
        await ensureAssetBalance(secret, token.code, token.issuer, total);
      } catch (err) {
        if (err instanceof SubmitOutcomeUnknownError) {
          throw new ExternalServiceError('Stellar', `Could not confirm buying ${token.code} for this escrow; try again shortly`, 'escrow_funding_unconfirmed', { cause: err });
        }
        throw err;
      }

      ({ escrowId: onchainId, hash } = await escrow.createEscrow(
        secret, worker.stellar_public_key, token.address, specs.map((m) => m.amount), expiry, recordCreationIntent(begun.creationId),
      ));
    } catch (err) {
      if (err instanceof SubmitOutcomeUnknownError) {
        // The money may be locked already: never fail it here. The reconciler records it, or fails it, from the chain.
        logger.warn('Escrow creation submitted without a verdict; awaiting the chain', { creationId: begun.creationId, txHash: err.txHash });
        return res.status(202).json({ creationId: begun.creationId, status: 'submitted', txHash: err.txHash });
      }
      // Everything else means nothing landed: refused before signing, or rejected by the network or the contract.
      await failEscrowCreation(begun.creationId, err instanceof Error ? err.message : String(err));
      throw err;
    }

    let done;
    try {
      done = await completeEscrowCreation(begun.creationId, onchainId, hash);
    } catch (err) {
      // The escrow exists on chain; the creation keeps its hash, so the reconciler writes the rows after the time bound.
      logger.error('Escrow funded but not recorded yet; the reconciler will record it', { creationId: begun.creationId, hash, error: String(err) });
      return res.status(202).json({ creationId: begun.creationId, status: 'submitted', txHash: hash });
    }

    logger.info('Escrow created', { id: done.escrowId, onchainId: onchainId.toString(), hash, total: done.total });
    await audit({ actorId: req.headers['x-user-id'] as string | undefined, actorRole: 'enterprise', action: 'escrow.created', entityType: 'escrow', entityId: done.escrowId, detail: { workerId, total: done.total, tokenCode: token.code, milestones: milestones.length, txHash: hash } });
    res.status(201).json({ id: done.escrowId, onchainEscrowId: onchainId.toString(), txHash: hash });
  } catch (err) {
    next(err);
  }
});

// ── POST /escrows/:id/milestones/:idx/approve ─────────────────────────────────

router.post('/:id/milestones/:idx/approve', recoveryHold(), async (req: Request, res: Response, next: NextFunction) => {
  const ctx = await requireCompanyWrite(req, res);
  if (!ctx) return;
  const { id } = req.params;
  const idx = Number(req.params.idx);

  try {
    const escrowRes = await query(
      `SELECT id, worker_id, onchain_escrow_id, status, token_code FROM escrows WHERE id = $1 AND enterprise_id = $2`,
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

    await notifyEscrow(
      row.worker_id, 'escrow_milestone_approved', 'Milestone approved',
      `Milestone ${idx + 1} (${Number(ms.rows[0].amount)} ${row.token_code}) is approved — claim it from your wallet.`, id,
    );
    await audit({ actorId: req.headers['x-user-id'] as string | undefined, actorRole: 'enterprise', action: 'escrow.milestone_approved', entityType: 'milestone', entityId: `${id}:${idx}`, detail: { txHash: hash } });

    res.json({ txHash: hash });
  } catch (err) {
    next(err);
  }
});

// ── POST /escrows/:id/milestones/:idx/submit (worker) ─────────────────────────
// "The work is done": a note and/or links for the employer to review. Off-chain
// only — the contract's moment is the employer's approval.

router.post('/:id/milestones/:idx/submit', async (req: Request, res: Response, next: NextFunction) => {
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
    await notifyEscrow(
      row.enterprise_id, 'escrow_work_submitted', 'Work submitted for review',
      `Your worker submitted milestone ${idx + 1} for review.`, id,
    );
    await audit({ actorId: workerId, actorRole: 'worker', action: 'escrow.work_submitted', entityType: 'milestone', entityId: `${id}:${idx}` });
    res.json({ reviewStatus: 'submitted' });
  } catch (err) {
    next(err);
  }
});

// ── POST /escrows/:id/milestones/:idx/reject (enterprise) ─────────────────────
// Sends submitted work back with a reason; the worker can resubmit. Nothing
// on-chain changes — the milestone simply stays Pending.

router.post('/:id/milestones/:idx/reject', async (req: Request, res: Response, next: NextFunction) => {
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
    await notifyEscrow(
      row.worker_id, 'escrow_work_rejected', 'Changes requested',
      `Milestone ${idx + 1} was sent back: ${reason.slice(0, 140)}`, id,
    );
    await audit({ actorId: req.headers['x-user-id'] as string | undefined, actorRole: 'enterprise', action: 'escrow.work_rejected', entityType: 'milestone', entityId: `${id}:${idx}`, detail: { reason: reason.slice(0, 200) } });
    res.json({ reviewStatus: 'rejected' });
  } catch (err) {
    next(err);
  }
});

// ── POST /escrows/:id/milestones/:idx/claim (worker) ─────────────────────────

router.post('/:id/milestones/:idx/claim', async (req: Request, res: Response, next: NextFunction) => {
  const workerId = requireWorker(req, res);
  if (!workerId) return;
  const { id } = req.params;
  const idx = Number(req.params.idx);

  try {
    const escrowRes = await query(
      `SELECT id, enterprise_id, onchain_escrow_id, status, token_code FROM escrows WHERE id = $1 AND worker_id = $2`,
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

    await notifyEscrow(
      row.enterprise_id, 'escrow_milestone_claimed', 'Milestone claimed',
      `Your worker claimed milestone ${idx + 1} (${Number(ms.rows[0].amount)} ${row.token_code}).`, id,
    );
    await audit({ actorId: workerId, actorRole: 'worker', action: 'escrow.milestone_claimed', entityType: 'milestone', entityId: `${id}:${idx}`, detail: { amount: Number(ms.rows[0].amount), tokenCode: row.token_code, txHash: hash } });

    res.json({ txHash: hash });
  } catch (err) {
    next(err);
  }
});

// ── POST /escrows/:id/freeze (compliance admin) ───────────────────────────────
// Compliance hold: while frozen the contract blocks approve, claim and refund
// for this escrow. Admin-only — same role gate as the KYC flagged list.

router.post('/:id/freeze', async (req: Request, res: Response, next: NextFunction) => {
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
    await audit({ actorId: req.headers['x-user-id'] as string | undefined, actorRole: (req.headers['x-user-role'] as string | undefined) ?? 'unknown', action: frozen ? 'escrow.frozen' : 'escrow.unfrozen', entityType: 'escrow', entityId: id, detail: { txHash: hash } });
    res.json({ frozen, txHash: hash });
  } catch (err) {
    next(err);
  }
});

// ── POST /escrows/:id/return-frozen (compliance admin) ────────────────────────
// Resolves an upheld hold: only a frozen escrow can be resolved, and every tranche the
// worker has not yet claimed goes back to the enterprise. Admin-only, like /freeze.

router.post('/:id/return-frozen', async (req: Request, res: Response, next: NextFunction) => {
  if (req.headers['x-user-role'] !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { id } = req.params;

  try {
    const r = await query(`SELECT onchain_escrow_id, status, frozen, token_code FROM escrows WHERE id = $1`, [id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: 'Escrow not found' });
    if (row.status !== 'active') return res.status(409).json({ error: 'Escrow is no longer active' });
    if (!row.frozen) return res.status(409).json({ error: 'Freeze the escrow first — only a frozen escrow can be resolved' });

    const { returnedStroops, hash } = await escrow.returnFrozen(BigInt(row.onchain_escrow_id));
    await query(
      `UPDATE escrow_milestones SET status = 'refunded', refund_tx_hash = $2
        WHERE escrow_id = $1 AND status IN ('pending','approved')`,
      [id, hash],
    );
    await finalizeEscrowStatus(id);

    logger.warn('Frozen escrow returned to the enterprise', { id, hash, by: req.headers['x-user-id'] });
    await audit({ actorId: req.headers['x-user-id'] as string | undefined, actorRole: 'admin', action: 'escrow.returned_frozen', entityType: 'escrow', entityId: id, detail: { returned: fromStroops(returnedStroops), tokenCode: row.token_code, txHash: hash } });
    res.json({ returned: Number(fromStroops(returnedStroops)), tokenCode: row.token_code, txHash: hash });
  } catch (err) {
    next(err);
  }
});

// ── POST /escrows/reconcile (admin) ───────────────────────────────────────────
// Compare every active escrow with the chain and repair the database to match.
// { "repair": false } is a dry run that only reports the drift.

router.post('/reconcile', async (req: Request, res: Response, next: NextFunction) => {
  if (req.headers['x-user-role'] !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  try {
    const repair = (req.body as { repair?: unknown } | undefined)?.repair !== false;
    const report = await reconcileEscrows({ repair });
    logger.info('Manual escrow reconcile', { by: req.headers['x-user-id'], repair, ...report });
    res.json({ repair, ...report });
  } catch (err) {
    next(err);
  }
});

// ── POST /escrows/:id/refund ──────────────────────────────────────────────────

router.post('/:id/refund', async (req: Request, res: Response, next: NextFunction) => {
  const ctx = await requireCompanyWrite(req, res);
  if (!ctx) return;
  const { id } = req.params;

  try {
    const escrowRes = await query(
      `SELECT id, worker_id, onchain_escrow_id, status, expires_at, token_code FROM escrows
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

    await audit({ actorId: req.headers['x-user-id'] as string | undefined, actorRole: 'enterprise', action: 'escrow.refunded', entityType: 'escrow', entityId: id, detail: { refunded: fromStroops(refundedStroops), tokenCode: row.token_code, txHash: hash } });
    res.json({ refunded: Number(fromStroops(refundedStroops)), tokenCode: row.token_code, txHash: hash });
  } catch (err) {
    next(err);
  }
});

// ── GET /escrows/my-clearance (worker) ────────────────────────────────────────
// The worker's own on-chain compliance clearance, so the KYC page can show what the contract sees.

router.get('/my-clearance', async (req: Request, res: Response, next: NextFunction) => {
  const workerId = requireWorker(req, res);
  if (!workerId) return;
  try {
    const publicKey = await workerPublicKey(workerId);
    if (!publicKey) return res.json({ cleared: false, expiry: null, attestation: null });

    const clearance = await escrow.getClearance(publicKey);
    const cleared = !!clearance && clearance.expiry * 1000 > Date.now();
    res.json({ cleared, expiry: clearance?.expiry ?? null, attestation: clearance?.attestation ?? null });
  } catch (err) {
    next(new ExternalServiceError('Stellar', 'Could not read the on-chain clearance', 'clearance_unavailable', { cause: err }));
  }
});

// ── GET /escrows/cashout-options ──────────────────────────────────────────────
// Whether MoneyGram cash-out is configured on this deployment, so the UI only offers it when real.

router.get('/cashout-options', (_req: Request, res: Response) => {
  res.json({ moneygram: moneygramConfigured() });
});

// ── GET /escrows/summary ──────────────────────────────────────────────────────
// Escrow money in one place, one row per token (USDC, and XLM for earlier escrows): amounts in different tokens are
// never added together here. The dashboards convert each to the viewer's display currency before summing. Workers see
// their own, employers their company's.

router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
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
      `SELECT e.token_code,
         COALESCE(SUM(m.amount) FILTER (WHERE m.status IN ('pending', 'approved')), 0) AS locked,
         COALESCE(SUM(m.amount) FILTER (WHERE m.status = 'claimed'), 0) AS claimed,
         COALESCE(SUM(m.amount) FILTER (WHERE m.status = 'refunded'), 0) AS refunded
       FROM escrow_milestones m JOIN escrows e ON e.id = m.escrow_id
      WHERE ${column} = $1
      GROUP BY e.token_code`,
      [scopeId],
    );
    res.json({
      totals: r.rows.map((row) => ({
        tokenCode: row.token_code as string,
        locked: Number(row.locked),
        claimed: Number(row.claimed),
        refunded: Number(row.refunded),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /escrows — enterprise (company-scoped) or worker (own) ────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
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
        total: Number(r.total_amount),
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
    next(err);
  }
});

export default router;
