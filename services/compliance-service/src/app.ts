import express from 'express';
import { createLogger, NotFoundError } from '@funti3r/shared-utils';
import { screenNames } from './sanctions/screen.js';
import type { Deps } from './deps.js';
import { canDecide, kycAccess } from './access.js';
import { recordKycEvent } from './events.js';
import { openDetails, sealDetails } from './pii.js';

const logger = createLogger('ComplianceService');

// The kyc_records table stores status as one of: pending | approved | rejected
// | expired. The dashboards display 'verified', so map approved -> verified on
// the way out.
function toFrontendStatus(dbStatus: string): string {
  return dbStatus === 'approved' ? 'verified' : dbStatus;
}

function candidateNamesFromSubmission(details: Record<string, any>): string[] {
  return [
    details?.identity?.fullName,
    details?.identity?.legalName,
    details?.bankAccount?.accountHolderName,
  ].filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function createApp({ query, autoApprove }: Deps): express.Express {
  const app = express();
  app.use(express.json());

  // ── Health ──────────────────────────────────────────────────────────────────

  app.get('/health', (_, res) => {
    res.json({ status: 'healthy', service: 'compliance-service', autoApprove });
  });

  // ── Submit KYC ──────────────────────────────────────────────────────────────
  // Stores the whole submission payload, encrypted, in the `data` JSONB column. Auto-approves
  // when autoApprove is on. One record per user (upsert on user_id). You can only submit your
  // own KYC (a platform admin may submit on someone's behalf).
  //
  // Sanctions screening runs on every submission regardless of autoApprove — a
  // list match always forces 'rejected' so testnet auto-approve can never wave
  // through a flagged name.

  app.post('/submit', async (req, res) => {
    const { userId, ...details } = req.body ?? {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required' });
    }
    const requesterId = asString(req.headers['x-user-id']);
    const requesterRole = asString(req.headers['x-user-role']) ?? 'unknown';
    if (requesterId !== userId && requesterRole !== 'admin') {
      return res.status(403).json({ error: 'You can only submit your own KYC' });
    }

    try {
      const sanctionsMatches = screenNames(candidateNamesFromSubmission(details));
      const sanctionsStatus = sanctionsMatches.length > 0 ? 'flagged' : 'clear';

      const status = sanctionsStatus === 'flagged' ? 'rejected' : (autoApprove ? 'approved' : 'pending');
      const verifiedAt = status === 'approved' ? new Date().toISOString() : null;

      const result = await query(
        `INSERT INTO kyc_records (user_id, provider, status, data, verified_at, sanctions_status, sanctions_matches, sanctions_checked_at, updated_at)
           VALUES ($1, 'manual', $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           status = EXCLUDED.status,
           data = EXCLUDED.data,
           verified_at = EXCLUDED.verified_at,
           sanctions_status = EXCLUDED.sanctions_status,
           sanctions_matches = EXCLUDED.sanctions_matches,
           sanctions_checked_at = EXCLUDED.sanctions_checked_at,
           updated_at = NOW()
         RETURNING id, status, verified_at, sanctions_status, created_at`,
        [userId, status, sealDetails(details), verifiedAt, sanctionsStatus, JSON.stringify(sanctionsMatches)],
      );

      const row = result.rows[0];
      await recordKycEvent(query, {
        userId, actorId: requesterId ?? null, actorRole: requesterRole, action: 'submitted',
        detail: { status, sanctionsStatus, matchCount: sanctionsMatches.length, autoApprove },
      });
      logger.info('KYC submitted', { userId, status, sanctionsStatus, matchCount: sanctionsMatches.length, autoApprove });
      res.status(201).json({
        id: row.id,
        status: toFrontendStatus(row.status),
        verified_at: row.verified_at,
        submitted_at: row.created_at,
        sanctions_status: row.sanctions_status,
        message: sanctionsStatus === 'flagged'
          ? 'Blocked pending compliance review (sanctions list match)'
          : (autoApprove ? 'Auto-approved (testnet)' : 'Under review'),
      });
    } catch (err) {
      logger.error('KYC submission failed', { userId, error: String(err) });
      res.status(500).json({ error: 'KYC submission failed' });
    }
  });

  // ── Status check ────────────────────────────────────────────────────────────

  app.get('/:userId/status', async (req, res) => {
    try {
      const result = await query(
        `SELECT id, status, verified_at, created_at, updated_at, sanctions_status, sanctions_checked_at
           FROM kyc_records WHERE user_id = $1`,
        [req.params.userId],
      );

      if (result.rows.length === 0) {
        // No submission yet. In auto-approve mode report verified so the dashboard
        // unlocks without a manual step; otherwise report pending.
        if (autoApprove) {
          return res.json({ status: 'verified', verified_at: new Date().toISOString(), submitted_at: null });
        }
        return res.status(404).json({ status: 'pending', message: 'No KYC submission found' });
      }

      const row = result.rows[0];
      res.json({
        id: row.id,
        status: toFrontendStatus(row.status),
        verified_at: row.verified_at,
        submitted_at: row.created_at,
        updated_at: row.updated_at,
        sanctions_status: row.sanctions_status,
        sanctions_checked_at: row.sanctions_checked_at,
      });
    } catch (err) {
      logger.error('Status check failed', { error: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Bulk status check ───────────────────────────────────────────────────────
  // Used by list views (e.g. the Workers page) to avoid an N+1 request pattern —
  // one call for all worker ids instead of one per worker.

  app.post('/status/bulk', async (req, res) => {
    const { userIds } = req.body as { userIds?: string[] };
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds must be a non-empty array' });
    }

    try {
      const result = await query(
        `SELECT user_id, status, verified_at, created_at, updated_at, sanctions_status
           FROM kyc_records WHERE user_id = ANY($1::uuid[])`,
        [userIds],
      );

      const statuses: Record<string, unknown> = {};
      for (const row of result.rows) {
        statuses[row.user_id] = {
          id: row.id,
          status: toFrontendStatus(row.status),
          verified_at: row.verified_at,
          submitted_at: row.created_at,
          updated_at: row.updated_at,
          sanctions_status: row.sanctions_status,
        };
      }

      // Same default the single-user status route uses for "no submission yet".
      for (const userId of userIds) {
        if (statuses[userId]) continue;
        statuses[userId] = autoApprove
          ? { status: 'verified', verified_at: new Date().toISOString(), submitted_at: null }
          : { status: 'pending', submitted_at: null };
      }

      res.json({ statuses });
    } catch (err) {
      logger.error('Bulk status check failed', { error: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Flagged (sanctions match) records, admin only ───────────────────────────
  // Registered ahead of the `/:userId` param route below so this literal path
  // isn't swallowed as a userId.

  app.get('/flagged', async (req, res) => {
    if (req.headers['x-user-role'] !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }
    try {
      const result = await query(
        `SELECT user_id, status, sanctions_matches, sanctions_checked_at, created_at
           FROM kyc_records WHERE sanctions_status = 'flagged' ORDER BY sanctions_checked_at DESC`,
      );
      res.json({ flagged: result.rows });
    } catch (err) {
      logger.error('Flagged sanctions list failed', { error: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Full KYC details ────────────────────────────────────────────────────────
  // The user themself, a platform admin, or a member of a company that has this user as a worker.
  // Never another company: a submission holds ID, bank and tax numbers.

  app.get('/:userId', async (req, res) => {
    const targetUserId = req.params.userId;
    try {
      const access = await kycAccess(
        query, asString(req.headers['x-user-id']), asString(req.headers['x-user-role']), targetUserId,
      );
      if (!access) return res.status(403).json({ error: 'Not authorized to view this KYC record' });

      const result = await query(
        `SELECT id, user_id, status, data, verified_at, created_at, updated_at, sanctions_status, sanctions_matches
           FROM kyc_records WHERE user_id = $1`,
        [targetUserId],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'No KYC record found' });
      }

      const row = result.rows[0];
      // Flatten the stored submission payload so the UI can read fields directly.
      // Computed fields spread LAST — a submitter can put arbitrary keys (e.g.
      // "status") in their own submission payload; those must never override
      // the real computed values.
      res.json({
        ...openDetails(row.data),
        id: row.id,
        user_id: row.user_id,
        status: toFrontendStatus(row.status),
        verified_at: row.verified_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        sanctions_status: row.sanctions_status,
        sanctions_matches: row.sanctions_matches,
      });
    } catch (err) {
      logger.error('Get KYC details failed', { error: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── The audit trail of one user's KYC (same access as the record itself) ────

  app.get('/:userId/events', async (req, res) => {
    try {
      const access = await kycAccess(
        query, asString(req.headers['x-user-id']), asString(req.headers['x-user-role']), req.params.userId,
      );
      if (!access) return res.status(403).json({ error: 'Not authorized to view this KYC record' });
      const result = await query(
        `SELECT action, actor_role, detail, created_at FROM kyc_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.params.userId],
      );
      res.json({ events: result.rows });
    } catch (err) {
      logger.error('KYC events failed', { error: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Approve / Reject ────────────────────────────────────────────────────────
  // A platform admin, or an owner/admin of a company that has this user as a worker.
  // Clearing a sanctions flag is a platform-admin decision: an employer cannot wave through
  // a name the screening flagged. A manual reject leaves the flag alone.

  const setStatusHandler = (newStatus: 'approved' | 'rejected') => async (req: express.Request, res: express.Response) => {
    const targetUserId = req.params.userId;
    const requesterId = asString(req.headers['x-user-id']);
    const requesterRole = asString(req.headers['x-user-role']) ?? 'unknown';
    try {
      const access = await kycAccess(query, requesterId, requesterRole, targetUserId);
      if (!canDecide(access)) {
        return res.status(403).json({ error: 'Only an admin of the worker\'s company can decide this KYC' });
      }

      const current = await query(`SELECT sanctions_status FROM kyc_records WHERE user_id = $1`, [targetUserId]);
      if (current.rows.length === 0) throw new NotFoundError('KYC record');
      const flagged = current.rows[0].sanctions_status === 'flagged';
      if (newStatus === 'approved' && flagged && requesterRole !== 'admin') {
        return res.status(403).json({ error: 'A sanctions flag can only be cleared by a platform admin' });
      }

      const result = await query(
        `UPDATE kyc_records
            SET status = $1,
                verified_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE verified_at END,
                sanctions_status = CASE WHEN $1 = 'approved' THEN 'clear' ELSE sanctions_status END,
                updated_at = NOW()
          WHERE user_id = $2
          RETURNING status`,
        [newStatus, targetUserId],
      );
      if (result.rows.length === 0) throw new NotFoundError('KYC record');

      const reason = asString(req.body?.reason);
      await recordKycEvent(query, {
        userId: targetUserId, actorId: requesterId ?? null, actorRole: requesterRole, action: newStatus === 'approved' ? 'approved' : 'rejected',
        detail: reason ? { reason } : undefined,
      });
      if (newStatus === 'approved' && flagged) {
        await recordKycEvent(query, { userId: targetUserId, actorId: requesterId ?? null, actorRole: requesterRole, action: 'flag_cleared' });
      }
      res.json({ status: toFrontendStatus(result.rows[0].status) });
    } catch (err) {
      if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
      logger.error('KYC status update failed', { error: String(err) });
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  app.post('/:userId/approve', setStatusHandler('approved'));
  app.post('/:userId/reject', setStatusHandler('rejected'));

  return app;
}
