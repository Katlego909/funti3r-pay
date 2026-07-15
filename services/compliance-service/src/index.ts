import express from 'express';
import { createLogger, NotFoundError } from '@funti3r/shared-utils';
import { initPostgres, query } from '@funti3r/database';
import { screenNames } from './sanctions/screen.js';

const logger = createLogger('ComplianceService');

/**
 * COMPLIANCE_AUTO_APPROVE=true (testnet) marks every KYC submission as approved
 * immediately and reports any user as verified. Set false to require review.
 */
const AUTO_APPROVE = process.env.COMPLIANCE_AUTO_APPROVE === 'true';

const app = express();
app.use(express.json());

// The kyc_records table stores status as one of: pending | approved | rejected
// | expired. The dashboards display 'verified', so map approved -> verified on
// the way out.
function toFrontendStatus(dbStatus: string): string {
  return dbStatus === 'approved' ? 'verified' : dbStatus;
}

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', service: 'compliance-service', autoApprove: AUTO_APPROVE });
});

// ── Submit KYC ────────────────────────────────────────────────────────────────
// Stores the whole submission payload in the `data` JSONB column. Auto-approves
// when AUTO_APPROVE is on. One record per user (upsert on user_id).
//
// Sanctions screening runs on every submission regardless of AUTO_APPROVE — a
// list match always forces 'rejected' so testnet auto-approve can never wave
// through a flagged name.

function candidateNamesFromSubmission(details: Record<string, any>): string[] {
  return [
    details?.identity?.fullName,
    details?.identity?.legalName,
    details?.bankAccount?.accountHolderName,
  ].filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
}

const submitKycHandler = async (req: express.Request, res: express.Response) => {
  const { userId, ...details } = req.body ?? {};
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const sanctionsMatches = screenNames(candidateNamesFromSubmission(details));
    const sanctionsStatus = sanctionsMatches.length > 0 ? 'flagged' : 'clear';

    const status = sanctionsStatus === 'flagged' ? 'rejected' : (AUTO_APPROVE ? 'approved' : 'pending');
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
      [userId, status, JSON.stringify(details), verifiedAt, sanctionsStatus, JSON.stringify(sanctionsMatches)],
    );

    const row = result.rows[0];
    logger.info('KYC submitted', { userId, status, sanctionsStatus, matchCount: sanctionsMatches.length, autoApprove: AUTO_APPROVE });
    res.status(201).json({
      id: row.id,
      status: toFrontendStatus(row.status),
      verified_at: row.verified_at,
      submitted_at: row.created_at,
      sanctions_status: row.sanctions_status,
      message: sanctionsStatus === 'flagged'
        ? 'Blocked pending compliance review (sanctions list match)'
        : (AUTO_APPROVE ? 'Auto-approved (testnet)' : 'Under review'),
    });
  } catch (err) {
    logger.error('KYC submission failed', { userId, error: String(err) });
    res.status(500).json({ error: 'KYC submission failed' });
  }
};

app.post('/submit', submitKycHandler);

// ── Status check ──────────────────────────────────────────────────────────────

const statusHandler = async (req: express.Request, res: express.Response) => {
  try {
    const result = await query(
      `SELECT id, status, verified_at, created_at, updated_at, sanctions_status
         FROM kyc_records WHERE user_id = $1`,
      [req.params.userId],
    );

    if (result.rows.length === 0) {
      // No submission yet. In auto-approve mode report verified so the dashboard
      // unlocks without a manual step; otherwise report pending.
      if (AUTO_APPROVE) {
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
    });
  } catch (err) {
    logger.error('Status check failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.get('/:userId/status', statusHandler);

// ── Bulk status check ──────────────────────────────────────────────────────────
// Used by list views (e.g. the Workers page) to avoid an N+1 request pattern —
// one call for all worker ids instead of one per worker.

const statusBulkHandler = async (req: express.Request, res: express.Response) => {
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

    // Same default the single-user statusHandler uses for "no submission yet".
    for (const userId of userIds) {
      if (statuses[userId]) continue;
      statuses[userId] = AUTO_APPROVE
        ? { status: 'verified', verified_at: new Date().toISOString(), submitted_at: null }
        : { status: 'pending', submitted_at: null };
    }

    res.json({ statuses });
  } catch (err) {
    logger.error('Bulk status check failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.post('/status/bulk', statusBulkHandler);

// ── Flagged (sanctions match) records, admin only ─────────────────────────────
// Registered ahead of the `/:userId` param route below so this literal path
// isn't swallowed as a userId.

const flaggedHandler = async (req: express.Request, res: express.Response) => {
  const role = req.headers['x-user-role'];
  if (role !== 'admin') {
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
};

app.get('/flagged', flaggedHandler);

// ── Full KYC details (owner, admin, or enterprise) ────────────────────────────

const getKycHandler = async (req: express.Request, res: express.Response) => {
  const requesterId = req.headers['x-user-id'];
  const requesterRole = req.headers['x-user-role'];
  const targetUserId = req.params.userId;

  if (requesterId !== targetUserId && requesterRole !== 'admin' && requesterRole !== 'enterprise') {
    return res.status(403).json({ error: 'Not authorized to view this KYC record' });
  }

  try {
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
      ...(row.data ?? {}),
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
};

app.get('/:userId', getKycHandler);

// ── Approve / Reject (admin or enterprise) ────────────────────────────────────

const setStatusHandler = (newStatus: 'approved' | 'rejected') => async (req: express.Request, res: express.Response) => {
  const role = req.headers['x-user-role'];
  if (role !== 'admin' && role !== 'enterprise') {
    return res.status(403).json({ error: 'Admin or enterprise role required' });
  }
  try {
    // A manual approve clears a sanctions flag too — the reviewer has just
    // confirmed it was a false positive. A manual reject leaves the flag
    // alone (it's still relevant history for a rejection either way).
    const result = await query(
      `UPDATE kyc_records
          SET status = $1,
              verified_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE verified_at END,
              sanctions_status = CASE WHEN $1 = 'approved' THEN 'clear' ELSE sanctions_status END,
              updated_at = NOW()
        WHERE user_id = $2
        RETURNING status`,
      [newStatus, req.params.userId],
    );
    if (result.rows.length === 0) throw new NotFoundError('KYC record');
    res.json({ status: toFrontendStatus(result.rows[0].status) });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    logger.error('KYC status update failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

const approveHandler = setStatusHandler('approved');
const rejectHandler = setStatusHandler('rejected');

app.post('/:userId/approve', approveHandler);
app.post('/:userId/reject', rejectHandler);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function start() {
  try {
    await initPostgres();
    logger.info('PostgreSQL connected');
  } catch {
    logger.warn('PostgreSQL unavailable at startup');
  }

  const PORT = parseInt(process.env.COMPLIANCE_SERVICE_PORT || '3003', 10);
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Compliance Service running on port ${PORT}${AUTO_APPROVE ? ' [AUTO-APPROVE MODE]' : ''}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start', { error: String(err) });
  process.exit(1);
});
