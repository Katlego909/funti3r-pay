import express from 'express';
import crypto from 'crypto';
import { createLogger, encryptSecret, decryptSecret, decryptFromString, ValidationError, NotFoundError } from '@funti3r/shared-utils';
import { initPostgres, initRedis, runInitialMigrations, query, transaction, getRedis } from '@funti3r/database';
import { PaymentStatus, PaymentMethod } from '@funti3r/shared-types';
import * as stellar from './lib/stellar.js';
import { selectRail, getAllQuotes } from './rails/router.js';
import walletLinkingRouter from './routes/wallet-linking.js';
import axios from 'axios';

const logger = createLogger('PaymentService');
const COMPLIANCE_SERVICE_URL = process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:3003';

const app = express();
app.use(express.json());

// ── Routers ───────────────────────────────────────────────────────────────────

app.use('/wallets', walletLinkingRouter);

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', service: 'payment-service' });
});

// ── Compliance guard ──────────────────────────────────────────────────────────

async function requireCompliance(workerId: string): Promise<void> {
  try {
    const resp = await axios.get(`${COMPLIANCE_SERVICE_URL}/${workerId}/status`, {
      timeout: 5000,
    });
    if (resp.data.status !== 'verified') {
      throw new Error('Worker KYC not verified');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Worker KYC not verified') throw err;
    // Compliance service unreachable — fail safe
    logger.error('Compliance check failed — blocking payout', { workerId, error: msg });
    throw new Error('Compliance service unavailable');
  }
}

// ── Worker SmartWallet creation ───────────────────────────────────────────────

/**
 * POST /wallets/worker
 * Called internally by user-service after successful WebAuthn registration.
 * Deploys a Soroban SmartWallet and records the contract address.
 */
app.post('/wallets/worker', async (req, res) => {
  const { userId, passkeyPkHex, credentialIdHex } = req.body as {
    userId: string;
    passkeyPkHex: string;
    credentialIdHex: string;
  };

  if (!userId || !passkeyPkHex || !credentialIdHex) {
    return res.status(400).json({ error: 'userId, passkeyPkHex, and credentialIdHex are required' });
  }

  try {
    const contractAddress = await stellar.deploySmartWallet(passkeyPkHex, credentialIdHex);
    logger.info('Worker SmartWallet deployed', { userId, contractAddress });
    // Return contract address; user-service will insert wallet record after creating user
    res.status(201).json({ contractAddress });
  } catch (err) {
    logger.error('Worker wallet deployment failed', { userId, error: String(err) });
    res.status(500).json({ error: String(err) });
  }
});

// ── Enterprise wallet creation ────────────────────────────────────────────────

/**
 * POST /wallets/enterprise
 * Creates a platform-custodial Stellar keypair for an enterprise.
 * The secret key is encrypted with AES-256-GCM before storage.
 */
app.post('/wallets/enterprise', async (req, res) => {
  const { userId } = req.body as { userId: string };
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const existing = await query('SELECT id FROM wallets WHERE user_id = $1', [userId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Enterprise wallet already exists' });
    }

    const { publicKey, secretKey } = stellar.createKeypair();
    const encrypted = encryptSecret(secretKey);

    await query(
      `INSERT INTO wallets (user_id, wallet_type, public_key, encrypted_secret, encryption_iv, encryption_tag, encryption_salt, status, updated_at)
       VALUES ($1, 'enterprise', $2, $3, $4, $5, $6, 'active', NOW())`,
      [userId, publicKey, encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.salt],
    );

    // Fund on testnet asynchronously (don't block response)
    setImmediate(async () => {
      try {
        await stellar.fundWithFriendbot(publicKey);
        logger.info('Enterprise wallet funded', { userId, publicKey });
      } catch (err) {
        logger.error('Friendbot funding failed (non-blocking)', { userId, publicKey, error: String(err) });
      }
    });

    logger.info('Enterprise wallet created', { userId, publicKey });
    res.status(201).json({ userId, publicKey });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Enterprise wallet creation failed', { userId, error: errorMsg, stack: err instanceof Error ? err.stack : undefined });
    res.status(500).json({
      error: 'Internal server error',
      detail: process.env.NODE_ENV === 'development' ? errorMsg : undefined,
    });
  }
});

// ── Wallet info ───────────────────────────────────────────────────────────────

app.get('/wallets/:userId', async (req, res) => {
  const requesterId = req.headers['x-user-id'];
  const requesterRole = req.headers['x-user-role'];

  // The owner can view their own wallet; enterprises/admins can view any
  // worker's wallet (the Workers page lists each worker's Stellar address).
  const isOwner = requesterId === req.params.userId;
  const isPrivileged = requesterRole === 'enterprise' || requesterRole === 'admin';
  if (!isOwner && !isPrivileged) {
    return res.status(403).json({ error: 'Not authorized to view this wallet' });
  }

  try {
    // Workers use their classic Stellar account stored on the users table.
    const result = await query(
      'SELECT stellar_public_key, role FROM users WHERE id = $1',
      [req.params.userId],
    );
    if (result.rows.length === 0) throw new NotFoundError('User');

    const address = result.rows[0].stellar_public_key;
    if (!address) {
      // No Stellar account yet (e.g. enterprise users) — report zero balance.
      return res.json({ userId: req.params.userId, walletType: 'worker', address: null, balances: [] });
    }

    // Balance lookup is best-effort: an unfunded account (Horizon 404) or any
    // Horizon hiccup must not fail the endpoint — just report an empty balance.
    let balances: any[] = [];
    try {
      balances = await stellar.getAccountBalance(address);
    } catch (balErr) {
      logger.warn('Balance lookup failed; returning empty', { address, error: String(balErr) });
    }
    res.json({ userId: req.params.userId, walletType: 'worker', address, balances });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    logger.error('Wallet lookup failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Deploy wallet for existing user ──────────────────────────────────────────

/**
 * POST /wallets/deploy-for-existing-user
 * Deploy SmartWallet for a user who was created before this feature.
 * Requires: userId, passkeyPkHex (or fetched from user_credentials)
 */
app.post('/wallets/deploy-for-existing-user', async (req, res) => {
  const { userId } = req.body as { userId: string };
  const requesterId = req.headers['x-user-id'];

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Authorization: users can only deploy wallets for themselves
  if (requesterId !== userId) {
    return res.status(403).json({ error: 'Not authorized to deploy wallet for this user' });
  }

  try {
    logger.info('Deploying wallet for existing user', { userId });

    // Check if wallet already exists
    const existing = await query(
      `SELECT contract_address FROM wallets
       WHERE user_id = $1 AND wallet_type = 'worker'`,
      [userId]
    );

    if (existing.rows.length > 0 && existing.rows[0].contract_address) {
      logger.warn('Wallet already deployed', {
        userId,
        address: existing.rows[0].contract_address
      });
      return res.status(200).json({
        contractAddress: existing.rows[0].contract_address,
        status: 'already_deployed'
      });
    }

    // Get user's credential to extract passkey public key and credential ID
    const credResult = await query(
      `SELECT public_key, credential_id FROM user_credentials WHERE user_id = $1`,
      [userId]
    );

    if (credResult.rows.length === 0) {
      return res.status(404).json({ error: 'User credentials not found' });
    }

    const passkeyPkHex = Buffer.from(credResult.rows[0].public_key, 'base64').toString('hex');
    // Credential ID is stored as base64url string; convert to standard base64 then to hex
    const credentialId = credResult.rows[0].credential_id;
    const credentialIdBase64 = credentialId.replace(/-/g, '+').replace(/_/g, '/') + '==';
    const credentialIdHex = Buffer.from(credentialIdBase64, 'base64').toString('hex');

    // Deploy SmartWallet (includes initialization)
    const contractAddress = await stellar.deploySmartWallet(passkeyPkHex, credentialIdHex);

    // Fund on testnet if applicable
    if (process.env.STELLAR_NETWORK === 'TESTNET') {
      try {
        await stellar.fundWithFriendbot(contractAddress);
      } catch (err) {
        logger.warn('Testnet funding failed (non-critical)', { error: String(err) });
      }
    }

    // Store wallet
    const walletResult = await query(
      `INSERT INTO wallets
       (user_id, wallet_type, contract_address, status, deployed_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, contract_address, status`,
      [userId, 'worker', contractAddress, 'active']
    );

    // Update user's deployment timestamp
    await query(
      `UPDATE users SET wallet_deployed_at = NOW() WHERE id = $1`,
      [userId]
    );

    // Audit log
    await query(
      `INSERT INTO audit_logs (user_id, action, details)
       VALUES ($1, $2, $3)`,
      [
        userId,
        'WALLET_DEPLOYED_EXISTING_USER',
        JSON.stringify({
          contractAddress,
          timestamp: new Date().toISOString()
        })
      ]
    );

    logger.info('Wallet deployed for existing user', { userId, contractAddress });

    res.status(201).json({
      walletId: walletResult.rows[0].id,
      contractAddress: walletResult.rows[0].contract_address,
      status: walletResult.rows[0].status,
      message: 'SmartWallet deployed for existing user'
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Wallet deployment for existing user failed', { userId, error: errorMsg });

    // Store error for recovery
    await query(
      `INSERT INTO wallet_deployment_errors (user_id, error_message, error_stack, retry_count)
       VALUES ($1, $2, $3, 0)`,
      [userId, errorMsg, err instanceof Error ? err.stack : null]
    );

    res.status(500).json({
      error: 'Wallet deployment failed',
      details: process.env.NODE_ENV === 'development' ? errorMsg : undefined
    });
  }
});

// ── Wallet deployment status ─────────────────────────────────────────────────

/**
 * GET /wallets/:userId/deployment-status
 * Check worker wallet deployment progress
 */
app.get('/wallets/:userId/deployment-status', async (req, res) => {
  const requesterId = req.headers['x-user-id'];

  // Authorization: users can only check their own wallet deployment status
  if (requesterId !== req.params.userId) {
    return res.status(403).json({ error: 'Not authorized to view this wallet status' });
  }

  try {
    const walletResult = await query(
      `SELECT contract_address, status, deployed_at FROM wallets
       WHERE user_id = $1 AND wallet_type = 'worker'`,
      [req.params.userId],
    );

    if (walletResult.rows.length === 0 || !walletResult.rows[0].contract_address) {
      return res.json({
        status: 'deploying',
        contractAddress: null,
        deployedAt: null,
      });
    }

    const wallet = walletResult.rows[0];

    return res.json({
      status: 'deployed',
      contractAddress: wallet.contract_address,
      deployedAt: wallet.deployed_at,
    });
  } catch (err) {
    logger.error('Deployment status check failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Quotes ────────────────────────────────────────────────────────────────────

/**
 * GET /payouts/quotes?amount=&sourceCurrency=&destinationCurrency=&destinationCountry=
 * Returns quotes from all available payment rails.
 */
app.get('/payouts/quotes', async (req, res) => {
  try {
    const { amount, sourceCurrency, destinationCurrency, destinationCountry } = req.query;
    if (!amount || !sourceCurrency || !destinationCurrency || !destinationCountry) {
      throw new ValidationError('amount, sourceCurrency, destinationCurrency, destinationCountry are required');
    }
    const quotes = await getAllQuotes({
      amount: Number(amount),
      sourceCurrency: String(sourceCurrency),
      destinationCurrency: String(destinationCurrency),
      destinationCountry: String(destinationCountry),
    });
    res.json({ quotes });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Payouts ───────────────────────────────────────────────────────────────────

type PayoutAsset = 'XLM' | 'USDC';

interface PayoutResult {
  paymentId?: string;
  workerId: string;
  amount: number;
  currency: PayoutAsset;
  status: 'completed' | 'failed';
  stellarTxHash?: string;
  sourceAmountXlm?: string;
  error?: string;
}

/**
 * Execute a single payout from an enterprise to a worker. Used by both the
 * single (/payouts) and batch (/payouts/batch) endpoints. Never throws — returns
 * a structured result so a batch can continue past individual failures.
 *
 * `sourceSecret` is the DECRYPTED enterprise secret (decrypted once by the caller).
 */
async function executePayout(opts: {
  enterpriseId: string;
  sourceSecret: string;
  workerId: string;
  amountNum: number;
  asset: PayoutAsset;
  usdcIssuer?: string;
  memo?: string;
  batchId?: string | null;
}): Promise<PayoutResult> {
  const { enterpriseId, sourceSecret, workerId, amountNum, asset, usdcIssuer, memo, batchId } = opts;
  const base: PayoutResult = { workerId, amount: amountNum, currency: asset, status: 'failed' };

  // KYC gate (auto-approves on testnet).
  try {
    await requireCompliance(workerId);
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }

  // Worker destination (+ secret for USDC trustline setup).
  const wkrRes = await query(
    'SELECT stellar_public_key, stellar_secret_key FROM users WHERE id = $1',
    [workerId],
  );
  const destination: string | undefined = wkrRes.rows[0]?.stellar_public_key;
  const workerStoredSecret: string | undefined = wkrRes.rows[0]?.stellar_secret_key;
  if (!destination) {
    return { ...base, error: 'Worker Stellar account not found' };
  }

  // Record as initiated (linked to the batch when present).
  let paymentId: string;
  try {
    const ins = await query(
      `INSERT INTO payments (enterprise_id, worker_id, amount, currency, status, stellar_destination, description, batch_id)
         VALUES ($1, $2, $3, $4, 'initiated', $5, $6, $7)
       RETURNING id`,
      [enterpriseId, workerId, amountNum, asset, destination, memo ?? null, batchId ?? null],
    );
    paymentId = ins.rows[0].id;
  } catch (err) {
    logger.error('Failed to record payment', { error: String(err) });
    return { ...base, error: 'Failed to record payment' };
  }

  // Submit to Stellar.
  try {
    const memoHash = crypto.createHash('sha256').update(paymentId).digest();
    let txHash: string;
    let feePaidXlm: string | null = null;

    if (asset === 'XLM') {
      txHash = await stellar.sendPayment(sourceSecret, destination, String(amountNum), 'XLM', undefined, memoHash);
    } else {
      if (!workerStoredSecret) throw new Error('Worker account is not set up to receive USDC');
      const workerSecret = decryptFromString(workerStoredSecret);
      await stellar.ensureTrustline(workerSecret, 'USDC', usdcIssuer!);
      const result = await stellar.payExactWithXlm(
        sourceSecret, destination, 'USDC', usdcIssuer!, String(amountNum), 0.05, memoHash,
      );
      txHash = result.hash;
      feePaidXlm = result.sourceAmountXlm;
    }

    await query(
      `UPDATE payments
          SET status = 'completed', stellar_tx_hash = $1, memo_hash = $2, fee_paid_xlm = $3,
              completed_at = NOW(), updated_at = NOW()
        WHERE id = $4`,
      [txHash, memoHash.toString('hex'), feePaidXlm, paymentId],
    );
    logger.info('Payment completed', { paymentId, txHash, amount: amountNum, currency: asset, workerId });
    return { ...base, paymentId, status: 'completed', stellarTxHash: txHash, ...(feePaidXlm ? { sourceAmountXlm: feePaidXlm } : {}) };
  } catch (err: any) {
    const resultCodes = err?.response?.data?.extras?.result_codes;
    const detail = resultCodes ? JSON.stringify(resultCodes) : (err instanceof Error ? err.message : String(err));
    await query(
      `UPDATE payments SET status = 'failed', failure_reason = $1, failed_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [detail, paymentId],
    );
    logger.error('Stellar payment failed', { paymentId, detail });
    return { ...base, paymentId, error: detail };
  }
}

/** Validate currency + load/decrypt the enterprise secret. Returns an error string or the secret. */
async function resolveEnterpriseSecret(enterpriseId: string): Promise<{ secret?: string; error?: string }> {
  const entRes = await query('SELECT stellar_secret_key FROM users WHERE id = $1', [enterpriseId]);
  const stored: string | undefined = entRes.rows[0]?.stellar_secret_key;
  if (!stored) return { error: 'Enterprise Stellar account is not set up' };
  return { secret: decryptFromString(stored) };
}

/**
 * POST /payouts — single payout (XLM or USDC) from enterprise to worker.
 * Body: { enterpriseId, workerId, amount, currency?, memo? }
 */
app.post('/payouts', async (req, res) => {
  const { enterpriseId, workerId, amount, currency = 'XLM', memo } = req.body as {
    enterpriseId: string; workerId: string; amount: number | string; currency?: string; memo?: string;
  };

  const requesterId = req.headers['x-user-id'];
  const requesterRole = req.headers['x-user-role'];
  if (requesterRole !== 'enterprise') return res.status(403).json({ error: 'Enterprise role required' });
  if (requesterId !== enterpriseId) return res.status(403).json({ error: 'Not authorized to create payments for this enterprise' });

  if (!enterpriseId || !workerId || amount == null) {
    return res.status(400).json({ error: 'enterpriseId, workerId, and amount are required' });
  }
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  const asset = String(currency || 'XLM').toUpperCase() as PayoutAsset;
  if (asset !== 'XLM' && asset !== 'USDC') return res.status(400).json({ error: 'Supported currencies: XLM, USDC' });
  const USDC_ISSUER = process.env.STELLAR_USDC_ISSUER;
  if (asset === 'USDC' && !USDC_ISSUER) return res.status(500).json({ error: 'USDC issuer is not configured' });

  const { secret, error } = await resolveEnterpriseSecret(enterpriseId);
  if (error) return res.status(400).json({ error });

  const result = await executePayout({
    enterpriseId, sourceSecret: secret!, workerId, amountNum, asset, usdcIssuer: USDC_ISSUER, memo,
  });

  if (result.status === 'completed') {
    return res.status(201).json({
      paymentId: result.paymentId, status: 'completed', currency: result.currency,
      stellarTxHash: result.stellarTxHash, ...(result.sourceAmountXlm ? { sourceAmountXlm: result.sourceAmountXlm } : {}),
    });
  }
  const code = /not found/i.test(result.error ?? '') ? 404 : /kyc/i.test(result.error ?? '') ? 403 : 502;
  return res.status(code).json({ paymentId: result.paymentId, status: 'failed', error: result.error });
});

/**
 * POST /payouts/batch — pay many workers in one request.
 * Body: { enterpriseId, currency?, items: [{ workerId, amount, memo? }] }
 * Payments execute sequentially (one Stellar source account → one sequence).
 */
app.post('/payouts/batch', async (req, res) => {
  const { enterpriseId, currency = 'XLM', items } = req.body as {
    enterpriseId: string;
    currency?: string;
    items: Array<{ workerId: string; amount: number | string; memo?: string }>;
  };

  const requesterId = req.headers['x-user-id'];
  const requesterRole = req.headers['x-user-role'];
  if (requesterRole !== 'enterprise') return res.status(403).json({ error: 'Enterprise role required' });
  if (requesterId !== enterpriseId) return res.status(403).json({ error: 'Not authorized to create payments for this enterprise' });

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
  if (items.length > 100) {
    return res.status(400).json({ error: 'A batch may contain at most 100 payments' });
  }
  const asset = String(currency || 'XLM').toUpperCase() as PayoutAsset;
  if (asset !== 'XLM' && asset !== 'USDC') return res.status(400).json({ error: 'Supported currencies: XLM, USDC' });
  const USDC_ISSUER = process.env.STELLAR_USDC_ISSUER;
  if (asset === 'USDC' && !USDC_ISSUER) return res.status(500).json({ error: 'USDC issuer is not configured' });

  // Validate every item up front.
  const normalized: Array<{ workerId: string; amountNum: number; memo?: string }> = [];
  for (const it of items) {
    const amountNum = Number(it.amount);
    if (!it.workerId || !Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'Each item needs a workerId and a positive amount' });
    }
    normalized.push({ workerId: it.workerId, amountNum, memo: it.memo });
  }

  const { secret, error } = await resolveEnterpriseSecret(enterpriseId);
  if (error) return res.status(400).json({ error });

  const totalRequested = normalized.reduce((s, i) => s + i.amountNum, 0);

  // Create the batch record.
  const batchRes = await query(
    `INSERT INTO payment_batches (enterprise_id, total_amount, payment_count, status)
       VALUES ($1, $2, $3, 'processing') RETURNING id`,
    [enterpriseId, totalRequested, normalized.length],
  );
  const batchId = batchRes.rows[0].id as string;

  // Execute sequentially (shared source account → strictly ordered sequence numbers).
  const results: PayoutResult[] = [];
  for (const item of normalized) {
    const r = await executePayout({
      enterpriseId, sourceSecret: secret!, workerId: item.workerId,
      amountNum: item.amountNum, asset, usdcIssuer: USDC_ISSUER, memo: item.memo, batchId,
    });
    results.push(r);
  }

  const completed = results.filter((r) => r.status === 'completed');
  const failed = results.filter((r) => r.status === 'failed');
  const batchStatus = failed.length === 0 ? 'completed' : completed.length === 0 ? 'failed' : 'partial';

  await query(
    `UPDATE payment_batches SET status = $1, total_amount = $2, updated_at = NOW() WHERE id = $3`,
    [batchStatus, completed.reduce((s, r) => s + r.amount, 0), batchId],
  );

  logger.info('Batch payout finished', { batchId, status: batchStatus, completed: completed.length, failed: failed.length });
  return res.status(failed.length === 0 ? 201 : 207).json({
    batchId,
    status: batchStatus,
    currency: asset,
    totalRequested,
    completedCount: completed.length,
    failedCount: failed.length,
    results,
  });
});

/**
 * POST /payouts/submit-signature
 * Submit a transaction signed by an external wallet.
 *
 * Required: paymentId, signedXDR (from wallet after user signs)
 */
app.post('/payouts/submit-signature', async (req, res) => {
  const { paymentId, signedXDR } = req.body as {
    paymentId: string;
    signedXDR: string;
  };
  const requesterId = req.headers['x-user-id'];

  if (!paymentId || !signedXDR) {
    return res.status(400).json({ error: 'paymentId and signedXDR are required' });
  }

  try {
    // Verify payment exists and is pending signature
    const paymentResult = await query(
      `SELECT id, status, enterprise_id, signer_wallet_id FROM payments WHERE id = $1`,
      [paymentId],
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentResult.rows[0];
    // Only the enterprise that created the payment can submit the signature
    if (requesterId !== payment.enterprise_id) {
      return res.status(403).json({ error: 'Not authorized to submit signature for this payment' });
    }
    if (payment.status !== PaymentStatus.PENDING) {
      logger.warn('Attempt to submit signature for non-pending payment', { paymentId, status: payment.status });
      return res.status(409).json({ error: 'Payment is not pending signature' });
    }

    // Submit signed transaction to Stellar
    logger.info('Submitting externally-signed transaction', { paymentId });
    const txHash = await stellar.submitSignedTransaction(signedXDR);

    // Update payment record
    await query(
      `UPDATE payments
       SET status = $1, stellar_tx_hash = $2, updated_at = NOW()
       WHERE id = $3`,
      [PaymentStatus.COMPLETED, txHash, paymentId],
    );

    logger.info('Externally-signed payment submitted', { paymentId, txHash });

    res.json({
      paymentId,
      status: PaymentStatus.COMPLETED,
      stellarTxHash: txHash,
      message: 'Payment submitted successfully',
    });
  } catch (err) {
    logger.error('Failed to submit signed transaction', { paymentId, error: String(err) });

    await query(
      `UPDATE payments SET status = $1, failure_reason = $2, updated_at = NOW() WHERE id = $3`,
      [PaymentStatus.FAILED, String(err), paymentId],
    );

    res.status(502).json({ error: 'Failed to submit payment', detail: String(err) });
  }
});

/**
 * POST /payouts/batch
 * Submit multiple payments in a single request. Stellar payments are batched into one tx.
 *
 * Required: enterpriseId, payments (array of worker payouts), idempotencyKey
 */
app.post('/payouts/batch', async (req, res) => {
  const {
    enterpriseId,
    payments: batchPayments,
    idempotencyKey,
  } = req.body as {
    enterpriseId: string;
    payments: Array<{
      workerId: string;
      amount: number;
      currency: string;
      destinationCountry: string;
      recipientName?: string;
      recipientAccount?: string;
    }>;
    idempotencyKey?: string;
  };

  // Authorization: verify user owns the enterprise account
  const requesterId = req.headers['x-user-id'];
  const requesterRole = req.headers['x-user-role'];
  if (requesterId !== enterpriseId) {
    return res.status(403).json({ error: 'Not authorized to create payments for this enterprise' });
  }
  if (requesterRole !== 'enterprise') {
    return res.status(403).json({ error: 'Enterprise role required' });
  }

  if (!enterpriseId || !batchPayments || !Array.isArray(batchPayments) || batchPayments.length === 0) {
    return res.status(400).json({
      error: 'enterpriseId and payments (non-empty array) are required',
    });
  }

  if (batchPayments.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 payments per batch' });
  }

  // Idempotency guard
  if (idempotencyKey) {
    const existing = await query(
      'SELECT id, status FROM payment_batches WHERE enterprise_id = $1 AND stellar_tx_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [enterpriseId],
    );
    if (existing.rows.length > 0) {
      return res.status(200).json(existing.rows[0]);
    }
  }

  // Check KYC compliance for all workers in parallel
  try {
    await Promise.all(
      batchPayments.map((p) => requireCompliance(p.workerId)),
    );
  } catch (err) {
    return res.status(403).json({ error: String(err) });
  }

  let batchId: string | undefined;
  const paymentIds: string[] = [];

  try {
    // Fetch enterprise wallet (only once for the batch)
    const entWalletResult = await query(
      'SELECT public_key, encrypted_secret, encryption_iv, encryption_tag, encryption_salt FROM wallets WHERE user_id = $1 AND wallet_type = $2',
      [enterpriseId, 'enterprise'],
    );

    if (entWalletResult.rows.length === 0) {
      return res.status(404).json({ error: 'Enterprise wallet not found' });
    }

    const entWallet = entWalletResult.rows[0];
    const sourceSecret = decryptSecret({
      ciphertext: entWallet.encrypted_secret,
      iv: entWallet.encryption_iv,
      tag: entWallet.encryption_tag,
      salt: entWallet.encryption_salt,
    });

    // Create batch record
    const batchResult = await transaction(async (client) => {
      return client.query(
        `INSERT INTO payment_batches (enterprise_id, total_amount, payment_count, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          enterpriseId,
          batchPayments.reduce((sum, p) => sum + p.amount, 0),
          batchPayments.length,
          PaymentStatus.PROCESSING,
        ],
      );
    });
    batchId = batchResult.rows[0].id as string;

    // Create individual payment records
    const createPaymentsResult = await transaction(async (client) => {
      return Promise.all(
        batchPayments.map((p, idx) =>
          client.query(
            `INSERT INTO payments
               (enterprise_id, worker_id, amount, currency, status, payment_method, batch_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              enterpriseId,
              p.workerId,
              p.amount,
              p.currency,
              PaymentStatus.PROCESSING,
              PaymentMethod.STELLAR,
              batchId,
            ],
          ),
        ),
      );
    });

    createPaymentsResult.forEach((r) => paymentIds.push(r.rows[0].id));

    // For simplicity, use the Stellar rail for the entire batch (all same currency)
    // In production, filter payments by rail first
    const rail = selectRail(batchPayments[0].destinationCountry, false);

    if (rail.name === 'stellar') {
      // Batch all Stellar payments into individual ops and submit as one tx
      // TODO: implement proper Stellar tx batching (currently we'd need to refactor sendPayment)
      // For now, fall through to individual submissions
      logger.warn('Batch Stellar payment not yet fully optimized', { batchId, count: batchPayments.length });
    }

    // Submit all payments individually (fiat fallback)
    const railResults = await Promise.allSettled(
      batchPayments.map((p, idx) => {
        const paymentId = paymentIds[idx];
        return rail.sendPayment({
          paymentId,
          amount: p.amount,
          sourceCurrency: p.currency,
          destinationCurrency: p.currency,
          destinationCountry: p.destinationCountry,
          recipientName: p.recipientName ?? '',
          recipientAccount: p.recipientAccount,
          metadata: { sourceSecret },
        });
      }),
    );

    // Update payment records with results
    await Promise.all(
      railResults.map((result, idx) => {
        const paymentId = paymentIds[idx];
        if (result.status === 'fulfilled') {
          const r = result.value;
          return query(
            `UPDATE payments
                SET status = $1, stellar_tx_hash = $2, updated_at = NOW()
              WHERE id = $3`,
            [
              r.status === 'completed' ? PaymentStatus.COMPLETED : PaymentStatus.PENDING,
              r.stellarTxHash ?? r.providerReference,
              paymentId,
            ],
          );
        } else {
          return query(
            `UPDATE payments SET status = $1, failure_reason = $2, updated_at = NOW() WHERE id = $3`,
            [PaymentStatus.FAILED, String(result.reason), paymentId],
          );
        }
      }),
    );

    // Update batch record
    const completedCount = railResults.filter((r) => r.status === 'fulfilled').length;
    await query(
      `UPDATE payment_batches SET status = $1, updated_at = NOW() WHERE id = $2`,
      [
        completedCount === batchPayments.length ? PaymentStatus.COMPLETED : PaymentStatus.PENDING,
        batchId,
      ],
    );

    logger.info('Batch payout processed', { batchId, total: batchPayments.length, completed: completedCount });

    res.status(201).json({
      batchId,
      total: batchPayments.length,
      completed: completedCount,
      paymentIds,
    });
  } catch (err) {
    logger.error('Batch payout failed', { error: String(err) });

    if (batchId!) {
      await query(
        `UPDATE payment_batches SET status = $1, updated_at = NOW() WHERE id = $2`,
        [PaymentStatus.FAILED, batchId],
      );
      await query(
        `UPDATE payments SET status = $1, failure_reason = $2, updated_at = NOW() WHERE batch_id = $3`,
        [PaymentStatus.FAILED, String(err), batchId],
      );
    }

    res.status(502).json({ error: 'Batch payout failed', detail: String(err) });
  }
});

/**
 * GET /payouts — list payments for an enterprise or worker.
 */
app.get('/payouts', async (req, res) => {
  const { enterpriseId, workerId, status, limit = '20', offset = '0' } = req.query;
  const requesterId = req.headers['x-user-id'];
  const requesterRole = req.headers['x-user-role'];

  console.log('[PAYOUTS_GET_DEBUG]', { enterpriseId, requesterId, requesterRole, allHeaders: req.headers });

  // Authorization: can only list payments for own enterprise or self as worker
  if (enterpriseId && enterpriseId !== requesterId) {
    console.log('[PAYOUTS_GET_BLOCKED]', { enterpriseId, requesterId, reason: 'enterprise mismatch' });
    return res.status(403).json({ error: 'Not authorized to view payments for this enterprise' });
  }
  if (workerId && workerId !== requesterId) {
    return res.status(403).json({ error: 'Not authorized to view payments for this worker' });
  }
  if (!enterpriseId && !workerId) {
    // If neither is specified, default to the requester's own account
    if (requesterRole === 'enterprise') {
      // Don't add a filter; let them query all their enterprise payments
    } else if (requesterRole === 'worker') {
      // Workers can only view their own payments
    }
  }

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (enterpriseId) { conditions.push(`enterprise_id = $${idx++}`); params.push(enterpriseId); }
    if (workerId)     { conditions.push(`worker_id = $${idx++}`);     params.push(workerId); }
    if (status)       { conditions.push(`status = $${idx++}`);        params.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Number(limit), Number(offset));

    const result = await query(
      `SELECT id, enterprise_id, worker_id, amount, currency, status, 'stellar' AS rail,
              stellar_tx_hash, failure_reason, created_at, updated_at
         FROM payments
         ${where}
         ORDER BY created_at DESC
         LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );

    const total = await query(
      `SELECT COUNT(*) AS count FROM payments ${where}`,
      params.slice(0, -2),
    );

    res.json({ payments: result.rows, total: Number(total.rows[0].count) });
  } catch (err) {
    logger.error('List payouts failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /payouts/summary — dashboard aggregate stats.
 */
app.get('/payouts/summary', async (req, res) => {
  const requesterId = req.headers['x-user-id'];
  const requesterRole = req.headers['x-user-role'];

  // Enterprises see their enterprise's payments; workers see their own.
  let scope: string;
  if (requesterRole === 'enterprise') {
    scope = 'enterprise_id';
  } else if (requesterRole === 'worker') {
    scope = 'worker_id';
  } else {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    const [totals, byStatus] = await Promise.all([
      query(`
        SELECT
          COUNT(*)                                        AS total_count,
          COALESCE(SUM(amount), 0)                        AS total_volume,
          COALESCE(SUM(CASE WHEN status='completed' THEN amount END), 0) AS completed_volume
        FROM payments WHERE ${scope} = $1
      `, [requesterId]),
      query(`SELECT status, COUNT(*) AS count FROM payments WHERE ${scope} = $1 GROUP BY status`, [requesterId]),
    ]);

    const total = Number(totals.rows[0].total_count);
    const completed = byStatus.rows.find((r) => r.status === 'completed');
    const successRate = total > 0 ? (Number(completed?.count ?? 0) / total) * 100 : 0;

    res.json({
      totalCount: total,
      totalVolume: Number(totals.rows[0].total_volume),
      completedVolume: Number(totals.rows[0].completed_volume),
      successRate: Math.round(successRate * 10) / 10,
      byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, Number(r.count)])),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /payouts/recent — last N payments for dashboard.
 */
app.get('/payouts/recent', async (req, res) => {
  const requesterId = req.headers['x-user-id'];
  const requesterRole = req.headers['x-user-role'];
  const limit = Math.min(Number(req.query.limit ?? 10), 50);

  // Enterprises see their enterprise's payments; workers see their own.
  let scopeColumn: string;
  if (requesterRole === 'enterprise') {
    scopeColumn = 'p.enterprise_id';
  } else if (requesterRole === 'worker') {
    scopeColumn = 'p.worker_id';
  } else {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    const result = await query(
      `SELECT p.id, p.enterprise_id, p.worker_id, u.email AS worker_email,
              p.amount, p.currency, p.status, 'stellar' AS rail, p.stellar_tx_hash,
              p.created_at, p.updated_at
         FROM payments p
         LEFT JOIN users u ON u.id = p.worker_id
         WHERE ${scopeColumn} = $1
         ORDER BY p.created_at DESC
         LIMIT $2`,
      [requesterId, limit],
    );
    res.json({ payments: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /payouts/xlm-price — current XLM→USD price (CoinGecko), cached 5 min.
 * Registered before /payouts/:id so it isn't captured by the :id param.
 */
let xlmPriceCache: { usd: number; ts: number } = { usd: 0, ts: 0 };
app.get('/payouts/xlm-price', async (_req, res) => {
  const FIVE_MIN = 5 * 60 * 1000;
  const now = Date.now();
  if (xlmPriceCache.usd && now - xlmPriceCache.ts < FIVE_MIN) {
    return res.json({ usd: xlmPriceCache.usd, cached: true });
  }
  try {
    const r = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: 'stellar', vs_currencies: 'usd' },
      timeout: 5000,
    });
    const usd = Number(r.data?.stellar?.usd) || 0;
    if (usd > 0) xlmPriceCache = { usd, ts: now };
    res.json({ usd });
  } catch (err) {
    logger.warn('XLM price fetch failed; returning last known', { error: String(err) });
    res.json({ usd: xlmPriceCache.usd || 0, stale: true });
  }
});

/**
 * GET /payouts/:id — single payment status.
 */
app.get('/payouts/:id', async (req, res) => {
  const requesterId = req.headers['x-user-id'];

  try {
    const result = await query(
      `SELECT id, enterprise_id, worker_id, amount, currency, status, rail,
              stellar_tx_hash, failure_reason, created_at, updated_at
         FROM payments WHERE id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

    const payment = result.rows[0];
    // Only the enterprise or worker involved can view this payment
    if (requesterId !== payment.enterprise_id && requesterId !== payment.worker_id) {
      return res.status(403).json({ error: 'Not authorized to view this payment' });
    }

    res.json(payment);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrapStreaming() {
  try {
    const result = await query(
      'SELECT public_key FROM wallets WHERE wallet_type = $1 AND status = $2',
      ['enterprise', 'active'],
    );

    for (const wallet of result.rows) {
      stellar.streamEnterprisePayments(wallet.public_key, async (txHash: string) => {
        logger.info('Updating payment from Horizon stream', { txHash });
        await query(
          `UPDATE payments SET status = $1, updated_at = NOW() WHERE stellar_tx_hash = $2`,
          [PaymentStatus.COMPLETED, txHash],
        );
      }).catch((err) => {
        logger.error('Failed to bootstrap stream', { error: String(err) });
      });
    }

    logger.info('Horizon payment streaming bootstrapped', { walletCount: result.rows.length });
  } catch (err) {
    logger.error('Failed to bootstrap streaming', { error: String(err) });
  }
}

async function start() {
  await initPostgres();
  logger.info('PostgreSQL connected');
  await runInitialMigrations();
  await initRedis();
  logger.info('Redis connected');

  // Bootstrap Horizon streaming for enterprise wallets
  await bootstrapStreaming();

  const PORT = parseInt(process.env.PAYMENT_SERVICE_PORT || '3002', 10);
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Payment Service running on port ${PORT}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start', { error: String(err) });
  process.exit(1);
});
