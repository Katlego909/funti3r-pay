import express from 'express';
import crypto from 'crypto';
import { createLogger, NotFoundError } from '@funti3r/shared-utils';
import { initPostgres, runInitialMigrations, query } from '@funti3r/database';
import { ComplianceStatus } from '@funti3r/shared-types';

const logger = createLogger('ComplianceService');

/**
 * COMPLIANCE_AUTO_APPROVE=true bypasses manual review and immediately marks
 * KYC submissions as VERIFIED. Only set this on testnet.
 */
const AUTO_APPROVE = process.env.COMPLIANCE_AUTO_APPROVE === 'true';

/**
 * COMPLIANCE_WEBHOOK_SECRET is used to verify HMAC signatures on incoming
 * callbacks from the KYC provider.
 */
const WEBHOOK_SECRET = process.env.COMPLIANCE_WEBHOOK_SECRET ?? '';

const app = express();
app.use(express.json());

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', service: 'compliance-service', autoApprove: AUTO_APPROVE });
});

// ── KYC submission ────────────────────────────────────────────────────────────

/**
 * POST /verify
 * Accepts KYC data for a user and, in auto-approve mode (testnet),
 * immediately marks them as VERIFIED. In production this creates a PENDING
 * record and triggers the external KYC provider.
 */
app.post('/verify', async (req, res) => {
  const { userId, idType, idNumber, dateOfBirth, country } = req.body as {
    userId: string;
    idType: string;
    idNumber: string;
    dateOfBirth?: string;
    country: string;
  };

  if (!userId || !idType || !idNumber || !country) {
    return res.status(400).json({ error: 'userId, idType, idNumber, country are required' });
  }

  try {
    const status = AUTO_APPROVE ? ComplianceStatus.VERIFIED : ComplianceStatus.PENDING;
    const verifiedAt = AUTO_APPROVE ? new Date().toISOString() : null;

    await query(
      `INSERT INTO kyc_records
         (user_id, status, id_type, id_number, date_of_birth, country, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         status       = EXCLUDED.status,
         id_type      = EXCLUDED.id_type,
         id_number    = EXCLUDED.id_number,
         date_of_birth = EXCLUDED.date_of_birth,
         country      = EXCLUDED.country,
         verified_at  = EXCLUDED.verified_at,
         updated_at   = NOW()`,
      [userId, status, idType, idNumber, dateOfBirth ?? null, country, verifiedAt],
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, 'KYC_SUBMISSION', $2)`,
      [userId, JSON.stringify({ idType, country, autoApproved: AUTO_APPROVE })],
    );

    logger.info('KYC submission', { userId, status, autoApprove: AUTO_APPROVE });

    res.status(201).json({ status, message: AUTO_APPROVE ? 'Auto-approved (testnet)' : 'Under review' });
  } catch (err) {
    logger.error('KYC submission failed', { userId, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Status check ──────────────────────────────────────────────────────────────

app.get('/:userId/status', async (req, res) => {
  try {
    const result = await query(
      `SELECT status, verified_at, expires_at, updated_at
         FROM kyc_records WHERE user_id = $1`,
      [req.params.userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: ComplianceStatus.PENDING, error: 'No KYC record found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Status check failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get full KYC details ──────────────────────────────────────────────────────

app.get('/:userId', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, user_id, status, id_type, id_number, date_of_birth, country, verified_at, created_at, updated_at
         FROM kyc_records WHERE user_id = $1`,
      [req.params.userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No KYC record found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Get KYC details failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Admin approval (used in production, and for testnet manual overrides) ─────

app.post('/:userId/approve', async (req, res) => {
  const role = req.headers['x-user-role'];
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }

  try {
    const result = await query(
      `UPDATE kyc_records
          SET status = $1, verified_at = NOW(), updated_at = NOW()
        WHERE user_id = $2
        RETURNING status`,
      [ComplianceStatus.VERIFIED, req.params.userId],
    );
    if (result.rows.length === 0) throw new NotFoundError('KYC record');

    await query(
      `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, 'KYC_APPROVED', $2)`,
      [req.params.userId, JSON.stringify({ approvedBy: req.headers['x-user-id'] })],
    );

    logger.info('KYC approved', { userId: req.params.userId });
    res.json({ status: ComplianceStatus.VERIFIED });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/:userId/reject', async (req, res) => {
  const role = req.headers['x-user-role'];
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }

  try {
    const { reason } = req.body as { reason?: string };
    const result = await query(
      `UPDATE kyc_records
          SET status = $1, updated_at = NOW()
        WHERE user_id = $2
        RETURNING status`,
      [ComplianceStatus.REJECTED, req.params.userId],
    );
    if (result.rows.length === 0) throw new NotFoundError('KYC record');

    await query(
      `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, 'KYC_REJECTED', $2)`,
      [req.params.userId, JSON.stringify({ reason, rejectedBy: req.headers['x-user-id'] })],
    );

    res.json({ status: ComplianceStatus.REJECTED });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── KYC provider webhook ──────────────────────────────────────────────────────

/**
 * POST /webhook
 * Receives async verification results from the external KYC provider.
 * Validates HMAC-SHA256 signature from X-Signature header.
 */
app.post('/webhook', async (req, res) => {
  if (!WEBHOOK_SECRET) {
    logger.warn('Webhook received but COMPLIANCE_WEBHOOK_SECRET is not set — ignoring');
    return res.status(501).json({ error: 'Webhook not configured' });
  }

  const signature = req.headers['x-signature'] as string | undefined;
  if (!signature) {
    return res.status(400).json({ error: 'Missing X-Signature header' });
  }

  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    logger.warn('Webhook signature mismatch');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { userId, status, referenceId } = req.body as {
    userId: string;
    status: 'verified' | 'rejected';
    referenceId: string;
  };

  try {
    const kycStatus =
      status === 'verified' ? ComplianceStatus.VERIFIED : ComplianceStatus.REJECTED;

    await query(
      `UPDATE kyc_records
          SET status = $1, verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE NULL END, updated_at = NOW()
        WHERE user_id = $2`,
      [kycStatus, userId],
    );

    await query(
      `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, 'KYC_WEBHOOK', $2)`,
      [userId, JSON.stringify({ status: kycStatus, referenceId })],
    );

    logger.info('KYC webhook processed', { userId, status: kycStatus });
    res.json({ received: true });
  } catch (err) {
    logger.error('Webhook processing failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function start() {
  await initPostgres();
  logger.info('PostgreSQL connected');
  await runInitialMigrations();

  const PORT = parseInt(process.env.COMPLIANCE_SERVICE_PORT || '3003', 10);
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Compliance Service running on port ${PORT}${AUTO_APPROVE ? ' [AUTO-APPROVE MODE]' : ''}`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} already in use`, { port: PORT });
    } else {
      logger.error('Server error', { error: String(err) });
    }
    process.exit(1);
  });
}

start().catch((err) => {
  logger.error('Failed to start', { error: String(err) });
  process.exit(1);
});
