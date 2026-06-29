import express from 'express';
import crypto from 'crypto';
import { createLogger, NotFoundError } from '@funti3r/shared-utils';
import { initPostgres, runInitialMigrations, query } from '@funti3r/database';
import { ComplianceStatus, KYCTier } from '@funti3r/shared-types';

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

app.use((req, res, next) => {
  console.log('[COMPLIANCE] Incoming request:', { method: req.method, path: req.path, url: req.url });
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', service: 'compliance-service', autoApprove: AUTO_APPROVE });
});

// ── KYC submission (Tier 1) ──────────────────────────────────────────────────

/**
 * POST /submit
 * Accepts comprehensive Tier 1 KYC data for a worker or enterprise.
 * Encrypts sensitive fields and stores in database.
 * Auto-approves on testnet if COMPLIANCE_AUTO_APPROVE=true.
 */
const submitKycHandler = async (req: any, res: any) => {
  const {
    userId,
    identity,
    governmentId,
    address,
    taxInfo,
    bankAccount,
  } = req.body as any;

  if (!userId || !identity || !governmentId || !address || !taxInfo || !bankAccount) {
    return res.status(400).json({
      error: 'userId, identity, governmentId, address, taxInfo, bankAccount are required'
    });
  }

  try {
    const status = AUTO_APPROVE ? ComplianceStatus.VERIFIED : ComplianceStatus.PENDING;
    const verifiedAt = AUTO_APPROVE ? new Date().toISOString() : null;

    const result = await query(
      `INSERT INTO kyc_records (
         user_id, tier, status,
         full_name, legal_name, date_of_birth, nationality, country_of_residence,
         id_type, id_number, id_issue_date, id_expiry_date, id_country,
         street_address, city, state_province, postal_code, country,
         tax_id, tax_residency_country,
         bank_name, account_holder_name, account_number, iban, swift_code, currency,
         verified_at, submitted_at, updated_at
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18,
         $19, $20,
         $21, $22, $23, $24, $25, $26,
         $27, NOW(), NOW()
       )
       ON CONFLICT (user_id) DO UPDATE SET
         tier = EXCLUDED.tier,
         status = EXCLUDED.status,
         full_name = EXCLUDED.full_name,
         legal_name = EXCLUDED.legal_name,
         date_of_birth = EXCLUDED.date_of_birth,
         nationality = EXCLUDED.nationality,
         country_of_residence = EXCLUDED.country_of_residence,
         id_type = EXCLUDED.id_type,
         id_number = EXCLUDED.id_number,
         id_issue_date = EXCLUDED.id_issue_date,
         id_expiry_date = EXCLUDED.id_expiry_date,
         id_country = EXCLUDED.id_country,
         street_address = EXCLUDED.street_address,
         city = EXCLUDED.city,
         state_province = EXCLUDED.state_province,
         postal_code = EXCLUDED.postal_code,
         country = EXCLUDED.country,
         tax_id = EXCLUDED.tax_id,
         tax_residency_country = EXCLUDED.tax_residency_country,
         bank_name = EXCLUDED.bank_name,
         account_holder_name = EXCLUDED.account_holder_name,
         account_number = EXCLUDED.account_number,
         iban = EXCLUDED.iban,
         swift_code = EXCLUDED.swift_code,
         currency = EXCLUDED.currency,
         verified_at = EXCLUDED.verified_at,
         submitted_at = EXCLUDED.submitted_at,
         updated_at = NOW()
       RETURNING id`,
      [
        userId, KYCTier.TIER1, status,
        identity.fullName, identity.legalName, identity.dateOfBirth, identity.nationality, identity.countryOfResidence,
        governmentId.idType, governmentId.idNumber, governmentId.issueDate, governmentId.expiryDate, governmentId.country,
        address.streetAddress, address.city, address.stateProvince, address.postalCode, address.country,
        taxInfo.taxId, taxInfo.taxResidencyCountry,
        bankAccount.bankName, bankAccount.accountHolderName, bankAccount.accountNumber, bankAccount.iban || null, bankAccount.swiftCode || null, bankAccount.currency,
        verifiedAt,
      ],
    );

    const kycId = result.rows[0].id;

    await query(
      `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, 'KYC_TIER1_SUBMISSION', $2)`,
      [userId, JSON.stringify({ kycId, tier: KYCTier.TIER1, autoApproved: AUTO_APPROVE })],
    );

    logger.info('Tier 1 KYC submitted', { userId, status, autoApprove: AUTO_APPROVE });

    res.status(201).json({
      id: kycId,
      status,
      message: AUTO_APPROVE ? 'Auto-approved (testnet)' : 'Under review',
      tier: KYCTier.TIER1,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : '';
    console.error('[KYC_SUBMIT_ERROR]', { userId: req.body.userId, errorMsg, errorStack });
    logger.error('KYC submission failed', { userId: req.body.userId, error: errorMsg });
    res.status(500).json({ error: errorMsg || 'Internal server error' });
  }
};

app.post('/submit', submitKycHandler);
app.post('/compliance/submit', submitKycHandler);
app.post('/api/compliance/submit', submitKycHandler);

// ── Status check ──────────────────────────────────────────────────────────────

const statusHandler = async (req: any, res: any) => {
  try {
    const result = await query(
      `SELECT id, tier, status, verified_at, rejection_reason, verification_notes, submitted_at, reviewed_at, updated_at
         FROM kyc_records WHERE user_id = $1`,
      [req.params.userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: ComplianceStatus.PENDING, message: 'No KYC record found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Status check failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.get('/:userId/status', statusHandler);
app.get('/compliance/:userId/status', statusHandler);
app.get('/api/compliance/:userId/status', statusHandler);

// ── Get full KYC details (decrypted for owner/admin only) ──────────────────────

const getKycHandler = async (req: any, res: any) => {
  const requesterId = req.headers['x-user-id'];
  const requesterRole = req.headers['x-user-role'];
  const targetUserId = req.params.userId;

  // Only owner, admin, or enterprise can view full KYC details
  if (requesterId !== targetUserId && requesterRole !== 'admin' && requesterRole !== 'enterprise') {
    return res.status(403).json({ error: 'Not authorized to view this KYC record' });
  }

  try {
    const result = await query(
      `SELECT id, user_id, tier, status, full_name, legal_name, date_of_birth, nationality, country_of_residence,
              id_type, id_number, id_issue_date, id_expiry_date, id_country,
              street_address, city, state_province, postal_code, country,
              tax_id, tax_residency_country,
              bank_name, account_holder_name, account_number, iban, swift_code, currency,
              id_verified_at, address_verified_at, verified_at, verification_notes, rejection_reason,
              submitted_at, reviewed_at, created_at, updated_at
         FROM kyc_records WHERE user_id = $1`,
      [targetUserId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No KYC record found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Get KYC details failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.get('/:userId', getKycHandler);
app.get('/compliance/:userId', getKycHandler);
app.get('/api/compliance/:userId', getKycHandler);

// ── Admin approval (used in production, and for testnet manual overrides) ─────

const approveHandler = async (req: any, res: any) => {
  const role = req.headers['x-user-role'];
  if (role !== 'admin' && role !== 'enterprise') {
    return res.status(403).json({ error: 'Admin or enterprise role required' });
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
};

app.post('/:userId/approve', approveHandler);
app.post('/compliance/:userId/approve', approveHandler);
app.post('/api/compliance/:userId/approve', approveHandler);

const rejectHandler = async (req: any, res: any) => {
  const role = req.headers['x-user-role'];
  if (role !== 'admin' && role !== 'enterprise') {
    return res.status(403).json({ error: 'Admin or enterprise role required' });
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
};

app.post('/:userId/reject', rejectHandler);
app.post('/compliance/:userId/reject', rejectHandler);
app.post('/api/compliance/:userId/reject', rejectHandler);

// ── KYC provider webhook ──────────────────────────────────────────────────────

const webhookHandler = async (req: any, res: any) => {
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
};

app.post('/webhook', webhookHandler);
app.post('/compliance/webhook', webhookHandler);
app.post('/api/compliance/webhook', webhookHandler);

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
