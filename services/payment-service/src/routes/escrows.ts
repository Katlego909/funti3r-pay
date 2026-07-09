import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { query } from '@funti3r/database';
import { createLogger, decryptFromString } from '@funti3r/shared-utils';
import { resolveCompanyContextOrSelf, canMoveMoney, isCompanyWorker } from '../lib/company.js';
import * as escrow from '../lib/escrow.js';
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

async function listMilestones(escrowIds: string[]) {
  if (escrowIds.length === 0) return {} as Record<string, unknown[]>;
  const rows = await query(
    `SELECT escrow_id, idx, description, amount, status, approved_at, claimed_at, claim_tx_hash
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
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to create escrow on-chain' });
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

    const { secret, error } = await resolveEnterpriseSecret(ctx.ownerUserId);
    if (!secret) return res.status(400).json({ error });

    const hash = await escrow.approveMilestone(secret, BigInt(row.onchain_escrow_id), idx);
    await query(
      `UPDATE escrow_milestones SET status = 'approved', approved_at = NOW() WHERE escrow_id = $1 AND idx = $2`,
      [id, idx],
    );

    await notify(
      row.worker_id, 'escrow_milestone_approved', 'Milestone approved',
      `Milestone ${idx + 1} (${Number(ms.rows[0].amount)} XLM) is approved — claim it from your wallet.`, id,
    );

    res.json({ txHash: hash });
  } catch (err) {
    logger.error('Failed to approve milestone', { id, idx, error: String(err) });
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to approve on-chain' });
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

    res.json({ txHash: hash });
  } catch (err) {
    logger.error('Failed to claim milestone', { id, idx, error: String(err) });
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to claim on-chain' });
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
      `UPDATE escrow_milestones SET status = 'refunded' WHERE escrow_id = $1 AND status = 'pending'`,
      [id],
    );
    await finalizeEscrowStatus(id);

    res.json({ refundedXlm: Number(refundedStroops) / 1e7, txHash: hash });
  } catch (err) {
    logger.error('Failed to refund escrow', { id, error: String(err) });
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to refund on-chain' });
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

    const milestones = await listMilestones(rows.rows.map((r) => r.id));
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
        expiresAt: r.expires_at,
        createTxHash: r.create_tx_hash,
        createdAt: r.created_at,
        milestones: milestones[r.id] ?? [],
      })),
    });
  } catch (err) {
    logger.error('Failed to list escrows', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
