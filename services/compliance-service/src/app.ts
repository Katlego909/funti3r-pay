import express from 'express';
import { createLogger, NotFoundError, ExternalServiceError, errorHandler, hasIdentity, isUuid, requireGatewayIdentity, requireRole, requestContext, registerHealth } from '@funti3r/shared-utils';
import { audit, oneOf, pageOf } from '@funti3r/database';
import { maskForReview } from './kycMask.js';
import { auditWriteFailures, metrics } from './metrics.js';
import { candidateBirthYearFromSubmission, candidateNamesFromSubmission } from './names.js';
import type { Deps } from './deps.js';
import { canDecide, kycAccess, visibleUserIds } from './access.js';
import { recordKycEvent } from './events.js';
import { openDetails, sealDetails } from './pii.js';
import { createManualProvider } from './providers/manual.js';

const logger = createLogger('ComplianceService');

// The kyc_records table stores status as one of: pending | approved | rejected
// | expired. The dashboards display 'verified', so map approved -> verified on
// the way out.
function toFrontendStatus(dbStatus: string): string {
  return dbStatus === 'approved' ? 'verified' : dbStatus;
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * An approval lapses: the record then reads 'expired' everywhere a status is reported, and the
 * payment service (which only clears 'verified' workers) stops them until they are re-verified.
 */
const EFFECTIVE_STATUS = `CASE WHEN status = 'approved' AND expires_at IS NOT NULL AND expires_at < NOW() THEN 'expired' ELSE status END`;
const DEFAULT_VALIDITY_DAYS = 365;
const MAX_BULK_IDS = 500;
const MAX_SCREEN_NAMES = 20;
const MAX_SCREEN_NAME_LENGTH = 200;

export function createApp({ query, autoApprove, sanctions, validityDays = DEFAULT_VALIDITY_DAYS, provider = createManualProvider({ autoApprove }), inTransaction = (fn) => fn(query) }: Deps): express.Express {
  const app = express();
  app.use(express.json());
  app.use(requireGatewayIdentity());
  app.use(requestContext('ComplianceService', metrics.observeRequest));
  app.get('/metrics', metrics.handler);

  // A user id goes straight into a UUID column; anything else is the caller's mistake (400), not a database error.
  app.param('userId', (_req, res, next, value) => {
    if (isUuid(value)) return next();
    res.status(400).json({ error: 'Invalid user id' });
  });

  // ── Health ──────────────────────────────────────────────────────────────────

  registerHealth(app, 'compliance-service', {
    database: { critical: true, run: async () => { await query('SELECT 1'); } },
    // Screening still runs on the built-in list without it, so a missing download is a warning, not an outage.
    sanctionsList: { critical: false, run: async () => { if (!(await sanctions.status())) throw new Error('no downloaded sanctions list is loaded'); } },
  });

  // ── Submit KYC ──────────────────────────────────────────────────────────────
  // Stores the whole submission payload, encrypted, in the `data` JSONB column. Auto-approves
  // when autoApprove is on. One record per user (upsert on user_id). You can only submit your
  // own KYC (a platform admin may submit on someone's behalf).
  //
  // Sanctions screening runs on every submission regardless of autoApprove — a
  // list match always forces 'rejected' so testnet auto-approve can never wave
  // through a flagged name.

  app.post('/submit', async (req, res, next) => {
    const { userId, ...details } = req.body ?? {};
    if (!isUuid(userId)) {
      return res.status(400).json({ error: 'userId is required and must be a valid id' });
    }
    const requesterId = asString(req.headers['x-user-id']);
    const requesterRole = asString(req.headers['x-user-role']) ?? 'unknown';
    if (requesterId !== userId && requesterRole !== 'admin') {
      return res.status(403).json({ error: 'You can only submit your own KYC' });
    }

    try {
      const sanctionsMatches = sanctions.screen(candidateNamesFromSubmission(details), candidateBirthYearFromSubmission(details));
      const sanctionsStatus = sanctionsMatches.length > 0 ? 'flagged' : 'clear';

      const decision = await provider.submit({ userId, details, sanctionsFlagged: sanctionsStatus === 'flagged' });
      const status = decision.status;
      const verifiedAt = status === 'approved' ? new Date().toISOString() : null;
      const expiresAt = status === 'approved' ? new Date(Date.now() + validityDays * 86_400_000).toISOString() : null;

      const row = await inTransaction(async (q) => {
      const result = await q(
        `INSERT INTO kyc_records (user_id, provider, provider_request_id, status, data, verified_at, expires_at, sanctions_status, sanctions_matches, sanctions_checked_at, updated_at)
           VALUES ($1, $8, $9, $2, $3, $4, $7, $5, $6, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           provider = EXCLUDED.provider,
           provider_request_id = EXCLUDED.provider_request_id,
           status = EXCLUDED.status,
           data = EXCLUDED.data,
           verified_at = EXCLUDED.verified_at,
           expires_at = EXCLUDED.expires_at,
           sanctions_status = EXCLUDED.sanctions_status,
           sanctions_matches = EXCLUDED.sanctions_matches,
           sanctions_checked_at = EXCLUDED.sanctions_checked_at,
           updated_at = NOW()
         RETURNING id, status, verified_at, sanctions_status, created_at`,
        [userId, status, sealDetails(details), verifiedAt, sanctionsStatus, JSON.stringify(sanctionsMatches), expiresAt, provider.name, decision.providerRef ?? null],
      );

      await recordKycEvent(q, {
        userId, actorId: requesterId ?? null, actorRole: requesterRole, action: 'submitted',
        detail: { status, sanctionsStatus, matchCount: sanctionsMatches.length, autoApprove },
      });
      return result.rows[0];
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
      next(err);
    }
  });

  // ── Sanctions list: what is loaded, a manual refresh, and a name check ──────
  // Registered ahead of every `/:userId/...` route so these literal paths are not read as user ids.

  app.get('/sanctions/status', async (_req, res, next) => {
    try {
      res.json({ list: await sanctions.status() });
    } catch (err) {
      next(err);
    }
  });

  app.post('/sanctions/refresh', requireRole('admin'), async (req, res, next) => {
    try {
      res.json(await sanctions.refresh());
    } catch (err) {
      next(new ExternalServiceError('OFAC', 'Sanctions list refresh failed', 'sanctions_refresh_failed', { cause: err }));
    }
  });

  // Screens bare names (the payment service uses it for the employer funding an escrow).
  app.post('/screen', (req, res) => {
    const names = (req.body as { names?: unknown })?.names;
    if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
      return res.status(400).json({ error: 'names must be an array of strings' });
    }
    // Each name is compared with every listed name, so an unbounded request is a cheap way to burn the CPU.
    if (names.length > MAX_SCREEN_NAMES || names.some((n: string) => n.length > MAX_SCREEN_NAME_LENGTH)) {
      return res.status(400).json({ error: `Send at most ${MAX_SCREEN_NAMES} names of up to ${MAX_SCREEN_NAME_LENGTH} characters` });
    }
    res.json({ matches: sanctions.screen(names as string[]) });
  });

  // ── Status check ────────────────────────────────────────────────────────────

  // A request with no identity is another service on the internal network (the payment service asking before it moves
  // money); one that carries an identity must be allowed to see this user's record, like every other KYC route.
  app.get('/:userId/status', async (req, res, next) => {
    if (!isUuid(req.params.userId)) return res.status(400).json({ error: 'userId must be a valid id' });
    try {
      if (hasIdentity(req.headers)) {
        const access = await kycAccess(
          query, asString(req.headers['x-user-id']), asString(req.headers['x-user-role']), req.params.userId,
        );
        if (!access) return res.status(403).json({ error: 'Not authorized to view this KYC record' });
      }
      const result = await query(
        `SELECT id, ${EFFECTIVE_STATUS} AS status, verified_at, created_at, updated_at, sanctions_status, sanctions_checked_at,
                EXISTS (SELECT 1 FROM kyc_events ev WHERE ev.user_id = kyc_records.user_id AND ev.action = 'approved') AS reviewed
           FROM kyc_records WHERE user_id = $1`,
        [req.params.userId],
      );

      if (result.rows.length === 0) {
        // No submission yet. In auto-approve mode report verified so the dashboard
        // unlocks without a manual step; otherwise report pending.
        if (autoApprove) {
          return res.json({ status: 'verified', verified_at: new Date().toISOString(), submitted_at: null, basis: 'no-submission' });
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
        // What 'verified' rests on, so evidence cannot mistake a testnet auto-approval for a review.
        basis: row.status === 'approved' ? (row.reviewed ? 'reviewed' : 'auto-approved') : 'none',
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Bulk status check ───────────────────────────────────────────────────────
  // Used by list views (e.g. the Workers page) to avoid an N+1 request pattern —
  // one call for all worker ids instead of one per worker.

  app.post('/status/bulk', async (req, res, next) => {
    const body = req.body as { userIds?: unknown };
    if (!Array.isArray(body.userIds) || body.userIds.length === 0 || body.userIds.length > MAX_BULK_IDS
        || body.userIds.some((id) => typeof id !== 'string')) {
      return res.status(400).json({ error: `userIds must be a non-empty array of at most ${MAX_BULK_IDS} ids` });
    }

    try {
      // Internal callers (no identity) get every id; anyone else gets only the people they may see.
      const userIds = hasIdentity(req.headers)
        ? await visibleUserIds(query, asString(req.headers['x-user-id']), asString(req.headers['x-user-role']), body.userIds as string[])
        : (body.userIds as string[]);
      if (userIds.length === 0) return res.json({ statuses: {} });

      const result = await query(
        `SELECT user_id, ${EFFECTIVE_STATUS} AS status, verified_at, created_at, updated_at, sanctions_status
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
      next(err);
    }
  });

  // ── Flagged (sanctions match) records, admin only ───────────────────────────
  // Registered ahead of the `/:userId` param route below so this literal path
  // isn't swallowed as a userId.

  app.get('/flagged', requireRole('admin'), async (req, res, next) => {
    try {
      const result = await query(
        `SELECT user_id, status, sanctions_matches, sanctions_checked_at, created_at
           FROM kyc_records WHERE sanctions_status = 'flagged' ORDER BY sanctions_checked_at DESC`,
      );
      res.json({ flagged: result.rows });
    } catch (err) {
      next(err);
    }
  });

  // ── The review queue, admin only (literal path, ahead of `/:userId`) ─────────
  // Who is waiting for a KYC decision (oldest first, to work through in order), or was rejected or has lapsed (newest
  // first). Never the submission itself: that stays behind the masked view and the audited reveal.

  const QUEUE_STATUSES = ['pending', 'rejected', 'expired'] as const;
  app.get('/queue', requireRole('admin'), async (req, res, next) => {
    try {
      const status = oneOf(req.query.status, QUEUE_STATUSES) ?? 'pending';
      const { limit, offset } = pageOf(req.query);
      const [rows, total] = await Promise.all([
        query(
          // The status rule reads kyc_records' own columns, so it runs before the join (users has a status column too).
          `SELECT k.user_id, u.email, u.role, k.status, k.sanctions_status, k.submitted_at, k.updated_at
             FROM (SELECT user_id, ${EFFECTIVE_STATUS} AS status, sanctions_status, created_at AS submitted_at, updated_at
                     FROM kyc_records) k
             JOIN users u ON u.id = k.user_id
            WHERE k.status = $1
            ORDER BY k.submitted_at ${status === 'pending' ? 'ASC' : 'DESC'}
            LIMIT ${limit} OFFSET ${offset}`,
          [status],
        ),
        query(`SELECT COUNT(*)::int AS count FROM kyc_records WHERE ${EFFECTIVE_STATUS} = $1`, [status]),
      ]);
      res.json({
        queue: rows.rows.map((r) => ({ ...r, status: toFrontendStatus(r.status) })),
        total: total.rows[0]?.count ?? 0, status, limit, offset,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Full KYC details ────────────────────────────────────────────────────────
  // The user themself, a platform admin, or a member of a company that has this user as a worker.
  // Never another company: a submission holds ID, bank and tax numbers.

  /** One person's KYC record as the API shows it, or null when they have none. */
  async function kycRecord(targetUserId: string, masked: boolean) {
    const result = await query(
      `SELECT id, user_id, ${EFFECTIVE_STATUS} AS status, data, verified_at, created_at, updated_at, sanctions_status, sanctions_matches
         FROM kyc_records WHERE user_id = $1`,
      [targetUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const details = openDetails(row.data);
    // Flatten the stored submission so the UI can read fields directly. Computed fields spread LAST: a submitter can
    // put arbitrary keys (e.g. "status") in their own payload, and those must never override the real values.
    return {
      ...(masked ? maskForReview(details) : details),
      masked,
      id: row.id,
      user_id: row.user_id,
      status: toFrontendStatus(row.status),
      verified_at: row.verified_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      sanctions_status: row.sanctions_status,
      sanctions_matches: row.sanctions_matches,
    };
  }

  app.get('/:userId', async (req, res, next) => {
    const targetUserId = req.params.userId;
    try {
      const access = await kycAccess(
        query, asString(req.headers['x-user-id']), asString(req.headers['x-user-role']), targetUserId,
      );
      if (!access) return res.status(403).json({ error: 'Not authorized to view this KYC record' });

      // A platform admin sees identifying numbers masked; the full record takes an audited reveal (below).
      const record = await kycRecord(targetUserId, access === 'admin');
      if (!record) return res.status(404).json({ error: 'No KYC record found' });
      res.json(record);
    } catch (err) {
      next(err);
    }
  });

  /**
   * A platform admin's deliberate look at someone's full KYC record, with a reason. Recorded in the audit trail BEFORE
   * anything is shown: if the record of the reveal cannot be written, nothing is revealed.
   */
  app.post('/:userId/reveal', requireRole('admin'), async (req, res, next) => {
    const targetUserId = req.params.userId;
    const reason = (req.body as { reason?: unknown } | undefined)?.reason;
    if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: 'A reason is required' });
    try {
      const exists = await query('SELECT 1 FROM kyc_records WHERE user_id = $1', [targetUserId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'No KYC record found' });
      const recorded = await audit(
        {
          actorId: asString(req.headers['x-user-id']), actorRole: 'admin', action: 'kyc.revealed', entityType: 'user',
          entityId: targetUserId, detail: { reason: reason.trim().slice(0, 500) },
        },
        { run: query, onFailure: () => auditWriteFailures.inc() },
      );
      if (!recorded) return res.status(503).json({ error: 'Could not record the reveal; nothing was shown. Try again.' });
      res.json(await kycRecord(targetUserId, false));
    } catch (err) {
      next(err);
    }
  });


  // ── The audit trail of one user's KYC (same access as the record itself) ────

  app.get('/:userId/events', async (req, res, next) => {
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
      next(err);
    }
  });

  // ── Approve / Reject ────────────────────────────────────────────────────────
  // A platform admin, or an owner/admin of a company that has this user as a worker.
  // Clearing a sanctions flag is a platform-admin decision: an employer cannot wave through
  // a name the screening flagged. A manual reject leaves the flag alone.

  const setStatusHandler = (newStatus: 'approved' | 'rejected') => async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const targetUserId = req.params.userId;
    const requesterId = asString(req.headers['x-user-id']);
    const requesterRole = asString(req.headers['x-user-role']) ?? 'unknown';
    try {
      const access = await kycAccess(query, requesterId, requesterRole, targetUserId);
      if (!canDecide(access)) {
        return res.status(403).json({ error: 'Only an admin of the worker\'s company can decide this KYC' });
      }

      // One transaction, with the record locked: two reviewers deciding at once are applied one after the other, and the
      // change and its audit events commit together or not at all.
      const outcome = await inTransaction(async (q) => {
      const current = await q(`SELECT sanctions_status FROM kyc_records WHERE user_id = $1 FOR UPDATE`, [targetUserId]);
      if (current.rows.length === 0) throw new NotFoundError('KYC record');
      const flagged = current.rows[0].sanctions_status === 'flagged';
      if (newStatus === 'approved' && flagged && requesterRole !== 'admin') return { denied: true as const };

      const result = await q(
        // $1 is cast once and used as text throughout: left to infer, Postgres sees varchar (the column) and text (the
        // comparisons) for the same parameter and refuses the statement.
        `UPDATE kyc_records
            SET status = $1::text,
                verified_at = CASE WHEN $1::text = 'approved' THEN NOW() ELSE verified_at END,
                expires_at = CASE WHEN $1::text = 'approved' THEN NOW() + make_interval(days => $3::int) ELSE expires_at END,
                sanctions_status = CASE WHEN $1::text = 'approved' THEN 'clear' ELSE sanctions_status END,
                updated_at = NOW()
          WHERE user_id = $2
          RETURNING status`,
        [newStatus, targetUserId, validityDays],
      );
      if (result.rows.length === 0) throw new NotFoundError('KYC record');

      const reason = asString(req.body?.reason);
      await recordKycEvent(q, {
        userId: targetUserId, actorId: requesterId ?? null, actorRole: requesterRole, action: newStatus === 'approved' ? 'approved' : 'rejected',
        detail: reason ? { reason } : undefined,
      });
      if (newStatus === 'approved' && flagged) {
        await recordKycEvent(q, { userId: targetUserId, actorId: requesterId ?? null, actorRole: requesterRole, action: 'flag_cleared' });
      }
      return { denied: false as const, status: result.rows[0].status as string };
      });
      if (outcome.denied) return res.status(403).json({ error: 'A sanctions flag can only be cleared by a platform admin' });
      res.json({ status: toFrontendStatus(outcome.status) });
    } catch (err) {
      next(err);
    }
  };

  app.post('/:userId/approve', setStatusHandler('approved'));
  app.post('/:userId/reject', setStatusHandler('rejected'));

  // Last, after every route: the one place a thrown error becomes a response.
  app.use(errorHandler(logger));
  return app;
}
