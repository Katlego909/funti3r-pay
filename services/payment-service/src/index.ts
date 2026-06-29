import express from 'express';
import { createLogger, encryptSecret, decryptSecret, ValidationError, NotFoundError } from '@funti3r/shared-utils';
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
  try {
    const result = await query(
      'SELECT wallet_type, public_key, contract_address FROM wallets WHERE user_id = $1',
      [req.params.userId],
    );
    if (result.rows.length === 0) throw new NotFoundError('Wallet');

    const wallet = result.rows[0];
    const address = wallet.wallet_type === 'worker'
      ? wallet.contract_address
      : wallet.public_key;

    if (!address) {
      return res.json({ userId: req.params.userId, walletType: wallet.wallet_type, status: 'deploying' });
    }

    // Smart contracts don't have balances like regular accounts
    if (wallet.wallet_type === 'worker') {
      return res.json({
        userId: req.params.userId,
        walletType: wallet.wallet_type,
        contract_address: address,
        contractAddress: address,
        status: 'active'
      });
    }

    const balances = await stellar.getAccountBalance(address);
    res.json({ userId: req.params.userId, walletType: wallet.wallet_type, address, balances });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
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

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
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

/**
 * POST /payouts
 * Initiates a cross-border worker payment.
 *
 * Required: enterpriseId, workerId, amount, currency, destinationCountry
 * Optional: idempotencyKey, preferFiat, quoteId, recipientAccount, recipientName, signerWalletId
 *
 * If signerWalletId is an external wallet, returns HTTP 202 with unsigned XDR for client to sign.
 * Otherwise, returns HTTP 201 with completed payment.
 */
app.post('/payouts', async (req, res) => {
  const {
    enterpriseId,
    workerId,
    amount,
    currency,
    destinationCountry,
    idempotencyKey,
    preferFiat = false,
    quoteId,
    recipientAccount,
    recipientName,
    signerWalletId,
  } = req.body as {
    enterpriseId: string;
    workerId: string;
    amount: number;
    currency: string;
    destinationCountry: string;
    idempotencyKey?: string;
    preferFiat?: boolean;
    quoteId?: string;
    recipientAccount?: string;
    recipientName?: string;
    signerWalletId?: string;
  };

  if (!enterpriseId || !workerId || !amount || !currency || !destinationCountry) {
    return res.status(400).json({
      error: 'enterpriseId, workerId, amount, currency, and destinationCountry are required',
    });
  }
  if (amount <= 0) return res.status(400).json({ error: 'amount must be positive' });

  // Idempotency guard
  if (idempotencyKey) {
    const existing = await query(
      'SELECT id, status, stellar_tx_hash FROM payments WHERE idempotency_key = $1',
      [idempotencyKey],
    );
    if (existing.rows.length > 0) {
      return res.status(200).json(existing.rows[0]);
    }
  }

  // KYC compliance check
  try {
    await requireCompliance(workerId);
  } catch (err) {
    return res.status(403).json({ error: String(err) });
  }

  let paymentId: string | undefined;

  try {
    // Fetch wallets
    const [entWalletResult, workerWalletResult, signerWalletResult] = await Promise.all([
      query(
        'SELECT id, public_key, encrypted_secret, encryption_iv, encryption_tag, encryption_salt, is_external FROM wallets WHERE user_id = $1 AND wallet_type = $2',
        [enterpriseId, 'enterprise'],
      ),
      query(
        'SELECT contract_address FROM wallets WHERE user_id = $1 AND wallet_type = $2',
        [workerId, 'worker'],
      ),
      signerWalletId ? query(
        'SELECT id, public_key, is_external, wallet_provider FROM wallets WHERE id = $1',
        [signerWalletId],
      ) : Promise.resolve({ rows: [] }),
    ]);

    if (entWalletResult.rows.length === 0) {
      return res.status(404).json({ error: 'Enterprise wallet not found' });
    }
    if (workerWalletResult.rows.length === 0) {
      return res.status(404).json({ error: 'Worker wallet not found' });
    }

    const entWallet = entWalletResult.rows[0];
    const workerContractAddress = workerWalletResult.rows[0].contract_address;

    if (!workerContractAddress) {
      return res.status(409).json({ error: 'Worker SmartWallet is still being deployed' });
    }

    // Determine signer wallet
    const signerWallet = signerWalletResult.rows.length > 0 ? signerWalletResult.rows[0] : entWallet;
    const isExternalSigner = signerWallet.is_external === true;

    // Decrypt enterprise secret key in-memory only (only needed for platform signers)
    let sourceSecret: string | undefined;
    if (!isExternalSigner) {
      sourceSecret = decryptSecret({
        ciphertext: entWallet.encrypted_secret,
        iv: entWallet.encryption_iv,
        tag: entWallet.encryption_tag,
        salt: entWallet.encryption_salt,
      });
    }

    // Select payment rail
    const rail = selectRail(destinationCountry, preferFiat);
    logger.info('Payment rail selected', { rail: rail.name, workerId, destinationCountry });

    // Create payment record in transaction
    const insertResult = await transaction(async (client) => {
      return client.query(
        `INSERT INTO payments
           (idempotency_key, enterprise_id, worker_id, amount, currency, status, payment_method, rail, signer_wallet_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          idempotencyKey ?? null,
          enterpriseId,
          workerId,
          amount,
          currency,
          isExternalSigner ? PaymentStatus.PENDING : PaymentStatus.PROCESSING,
          PaymentMethod.STELLAR,
          rail.name,
          signerWallet.id,
        ],
      );
    });

    paymentId = insertResult.rows[0].id as string;

    // If signer is external wallet, return unsigned XDR for client to sign
    if (isExternalSigner) {
      logger.info('Preparing unsigned payment for external wallet', { paymentId, walletProvider: signerWallet.wallet_provider });

      const memoHash = Buffer.from(paymentId);
      const unsignedXDR = await stellar.prepareUnsignedPayment(
        signerWallet.public_key,
        workerContractAddress,
        String(amount),
        currency === 'XLM' ? 'XLM' : currency,
        currency !== 'XLM' ? process.env.STELLAR_USDC_ISSUER : undefined,
        memoHash,
      );

      return res.status(202).json({
        paymentId,
        status: 'pending_signature',
        walletProvider: signerWallet.wallet_provider,
        unsignedXDR,
        message: 'Sign the transaction with your wallet and submit it to /payouts/submit-signature',
      });
    }

    // Platform wallet: execute normally
    // Note: sourceSecret is guaranteed to be defined here because we only reach this code
    // when isExternalSigner is false (external signer paths return early above)
    const railResult = await rail.sendPayment({
      paymentId,
      amount,
      sourceCurrency: currency,
      destinationCurrency: currency,
      destinationCountry,
      recipientName: recipientName ?? '',
      recipientAccount,
      stellarContractAddress: workerContractAddress,
      quoteId,
      metadata: { sourceSecret: sourceSecret! },
    });

    const memoHash = paymentId ? Buffer.from(paymentId).toString('hex') : undefined;
    if (memoHash && paymentId) {
      await query(
        `UPDATE payments
            SET status = $1, stellar_tx_hash = $2, memo_hash = $3, updated_at = NOW()
          WHERE id = $4`,
        [
          railResult.status === 'completed' ? PaymentStatus.COMPLETED : PaymentStatus.PENDING,
          railResult.stellarTxHash ?? railResult.providerReference,
          memoHash,
          paymentId,
        ],
      );
    }

    res.status(201).json({
      paymentId,
      status: railResult.status,
      rail: rail.name,
      providerReference: railResult.providerReference,
      stellarTxHash: railResult.stellarTxHash,
    });
  } catch (err) {
    logger.error('Payout failed', { error: String(err) });

    if (paymentId!) {
      await query(
        `UPDATE payments SET status = $1, failure_reason = $2, updated_at = NOW() WHERE id = $3`,
        [PaymentStatus.FAILED, String(err), paymentId],
      );
    }

    res.status(502).json({ error: 'Payment failed', detail: String(err) });
  }
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

  if (!paymentId || !signedXDR) {
    return res.status(400).json({ error: 'paymentId and signedXDR are required' });
  }

  try {
    // Verify payment exists and is pending signature
    const paymentResult = await query(
      `SELECT id, status, signer_wallet_id FROM payments WHERE id = $1`,
      [paymentId],
    );

    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentResult.rows[0];
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
      `SELECT id, enterprise_id, worker_id, amount, currency, status, rail,
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
app.get('/payouts/summary', async (_, res) => {
  try {
    const [totals, byStatus] = await Promise.all([
      query(`
        SELECT
          COUNT(*)                                        AS total_count,
          COALESCE(SUM(amount), 0)                        AS total_volume,
          COALESCE(SUM(CASE WHEN status='completed' THEN amount END), 0) AS completed_volume
        FROM payments
      `),
      query(`SELECT status, COUNT(*) AS count FROM payments GROUP BY status`),
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
  const limit = Math.min(Number(req.query.limit ?? 10), 50);
  try {
    const result = await query(
      `SELECT p.id, p.enterprise_id, p.worker_id, u.email AS worker_email,
              p.amount, p.currency, p.status, p.rail, p.stellar_tx_hash, p.created_at
         FROM payments p
         LEFT JOIN users u ON u.id = p.worker_id
         ORDER BY p.created_at DESC
         LIMIT $1`,
      [limit],
    );
    res.json({ payments: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /payouts/:id — single payment status.
 */
app.get('/payouts/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, enterprise_id, worker_id, amount, currency, status, rail,
              stellar_tx_hash, failure_reason, created_at, updated_at
         FROM payments WHERE id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
    res.json(result.rows[0]);
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
