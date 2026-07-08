import express from 'express';
import crypto from 'crypto';
import { createLogger, encryptSecret, decryptFromString, ValidationError, NotFoundError } from '@funti3r/shared-utils';
import { query } from '@funti3r/database';
import { PaymentStatus } from '@funti3r/shared-types';
import * as stellar from './lib/stellar.js';
import { Asset } from '@stellar/stellar-sdk';
import { getCurrency, isSupportedCurrency, PAYOUT_CURRENCIES } from './lib/currencies.js';
import { usdToCurrencyRate, getUsdRates, amountToUsd } from './lib/fx.js';
import { getAllQuotes } from './rails/router.js';
import walletLinkingRouter from './routes/wallet-linking.js';
import schedulesRouter from './routes/schedules.js';
import axios from 'axios';
import { resolveCompanyContext, resolveCompanyContextOrSelf, canMoveMoney, isCompanyWorker } from './lib/company.js';

const logger = createLogger('PaymentService');
const COMPLIANCE_SERVICE_URL = process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:3003';

const app: express.Express = express();
app.use(express.json());

// ── Routers ───────────────────────────────────────────────────────────────────

app.use('/wallets', walletLinkingRouter);
app.use('/schedules', schedulesRouter);

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', service: 'payment-service' });
});

// ── Compliance guard ──────────────────────────────────────────────────────────

export async function requireCompliance(workerId: string): Promise<void> {
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

/**
 * GET /wallets/company — the caller's COMPANY wallet (owner/admin/member all
 * see the same one, since custody is per-company, not per-login). Needed
 * because a teammate's own x-user-id never has a wallet of its own to show.
 */
app.get('/wallets/company', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;
  if (requesterRole !== 'enterprise' || !requesterId) {
    return res.status(403).json({ error: 'Enterprise role required' });
  }

  try {
    const ctx = await resolveCompanyContextOrSelf(requesterId, requesterRole);
    if (!ctx) return res.status(403).json({ error: 'You do not belong to a company' });

    const result = await query('SELECT stellar_public_key FROM users WHERE id = $1', [ctx.ownerUserId]);
    const address = result.rows[0]?.stellar_public_key;
    if (!address) return res.json({ address: null, balances: [] });

    let balances: any[] = [];
    try {
      balances = await stellar.getAccountBalance(address);
    } catch (balErr) {
      logger.warn('Balance lookup failed; returning empty', { address, error: String(balErr) });
    }
    res.json({ address, balances });
  } catch (err) {
    logger.error('Company wallet lookup failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/wallets/:userId', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;

  // The owner can view their own wallet; an enterprise account (owner/admin/
  // member) can view a wallet ONLY if it belongs to a worker of their own
  // company (a platform-level 'admin' role, unrelated to company_role,
  // keeps its existing unrestricted bypass — out of scope for this cutover).
  const isOwner = requesterId === req.params.userId;
  let isPrivileged = requesterRole === 'admin';
  if (!isOwner && !isPrivileged && requesterRole === 'enterprise' && requesterId) {
    const ctx = await resolveCompanyContext(requesterId);
    isPrivileged = !!ctx && await isCompanyWorker(ctx.companyId, req.params.userId);
  }
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

export interface PayoutResult {
  paymentId?: string;
  workerId: string;
  amount: number;
  currency: string;
  status: 'completed' | 'pending_claim' | 'failed';
  stellarTxHash?: string;
  sourceAmountXlm?: string;
  error?: string;
  /** Set for idempotency conflicts/mismatches so the route can return the right HTTP code. */
  httpStatus?: number;
}

/** sha256 of the fields that define "the same logical payout request". */
export function payoutPayloadHash(workerId: string, amountNum: number, asset: string): string {
  return crypto.createHash('sha256').update(JSON.stringify({ workerId, amountNum, asset })).digest('hex');
}

/**
 * Execute a single payout from an enterprise to a worker. Used by both the
 * single (/payouts) and batch (/payouts/batch) endpoints. Never throws — returns
 * a structured result so a batch can continue past individual failures.
 *
 * `asset` is any supported currency code. XLM is paid directly; USDC and local
 * currencies (NGN/KES/…) are delivered as an EXACT amount via a strict-receive
 * path payment funded from the enterprise's XLM (auto-creating the worker's
 * trustline first). `sourceSecret` is the DECRYPTED enterprise secret.
 */
export async function executePayout(opts: {
  enterpriseId: string;
  sourceSecret: string;
  workerId: string;
  amountNum: number;
  asset: string;
  memo?: string;
  batchId?: string | null;
  idempotencyKey?: string;
}): Promise<PayoutResult> {
  const { enterpriseId, sourceSecret, workerId, amountNum, asset, memo, batchId, idempotencyKey } = opts;
  const base: PayoutResult = { workerId, amount: amountNum, currency: asset, status: 'failed' };

  const def = getCurrency(asset);
  if (!def) return { ...base, error: `Unsupported currency: ${asset}` };
  if (def.kind !== 'native' && !def.issuer) {
    return { ...base, error: `Issuer not configured for ${asset}` };
  }

  // ── Idempotency ────────────────────────────────────────────────────────────
  // A key lets a replayed request (double-click, client retry) short-circuit
  // instead of submitting a second real Stellar payment. No key → today's
  // exact behavior (fully backward compatible for callers not yet passing one).
  const payloadHash = payoutPayloadHash(workerId, amountNum, asset);
  let resumingPaymentId: string | undefined;

  if (idempotencyKey) {
    const existing = await query(
      `SELECT id, status, payload_hash, stellar_tx_hash, fee_paid_xlm
         FROM payments WHERE enterprise_id = $1 AND idempotency_key = $2`,
      [enterpriseId, idempotencyKey],
    );
    const row = existing.rows[0];
    if (row) {
      if (row.payload_hash !== payloadHash) {
        return { ...base, error: 'Idempotency key already used for a different payment request', httpStatus: 422 };
      }
      if (row.status === 'completed' || row.status === 'pending_claim') {
        return {
          ...base, paymentId: row.id, status: row.status, stellarTxHash: row.stellar_tx_hash ?? undefined,
          ...(row.fee_paid_xlm ? { sourceAmountXlm: row.fee_paid_xlm } : {}),
        };
      }
      if (row.status === 'failed') {
        // Legitimate retry — atomic compare-and-swap, not check-then-update, so two
        // concurrent retries can't both resurrect the same row and double-submit.
        const cas = await query(
          `UPDATE payments SET status = 'initiated', failure_reason = NULL, updated_at = NOW()
             WHERE id = $1 AND status = 'failed' RETURNING id`,
          [row.id],
        );
        if (cas.rows.length === 0) {
          return { ...base, error: 'Payment with this idempotency key is already being processed', httpStatus: 409 };
        }
        resumingPaymentId = row.id;
      } else {
        // 'initiated', or any other CHECK-legal-but-unused status — treat as in-flight.
        return { ...base, error: 'Payment with this idempotency key is already being processed', httpStatus: 409 };
      }
    }
  }

  // KYC gate (auto-approves on testnet).
  try {
    await requireCompliance(workerId);
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }

  // Worker destination (+ secret for trustline setup on issued assets).
  const wkrRes = await query(
    'SELECT stellar_public_key, stellar_secret_key, email FROM users WHERE id = $1',
    [workerId],
  );
  const destination: string | undefined = wkrRes.rows[0]?.stellar_public_key;
  const workerEmail: string = wkrRes.rows[0]?.email ?? 'your worker';
  const workerStoredSecret: string | undefined = wkrRes.rows[0]?.stellar_secret_key;
  if (!destination) {
    return { ...base, error: 'Worker Stellar account not found' };
  }

  // Record as initiated (linked to the batch when present), unless we're
  // resuming a previously-failed row under the same idempotency key.
  let paymentId: string;
  if (resumingPaymentId) {
    paymentId = resumingPaymentId;
  } else {
    try {
      const ins = await query(
        `INSERT INTO payments (enterprise_id, worker_id, amount, currency, status, stellar_destination, description, batch_id, idempotency_key, payload_hash)
           VALUES ($1, $2, $3, $4, 'initiated', $5, $6, $7, $8, $9)
         RETURNING id`,
        [enterpriseId, workerId, amountNum, asset, destination, memo ?? null, batchId ?? null, idempotencyKey ?? null, idempotencyKey ? payloadHash : null],
      );
      paymentId = ins.rows[0].id;
    } catch (err: any) {
      if (err?.code === '23505' && idempotencyKey) {
        // Lost the insert race to a concurrent identical request — re-fetch and
        // report the same conflict a slightly-later lookup would have found.
        return { ...base, error: 'Payment with this idempotency key is already being processed', httpStatus: 409 };
      }
      logger.error('Failed to record payment', { error: String(err) });
      return { ...base, error: 'Failed to record payment' };
    }
  }

  // Submit to Stellar.
  try {
    const memoHash = crypto.createHash('sha256').update(paymentId).digest();
    let txHash: string;
    let feePaidXlm: string | null = null;
    let paymentStatus: PayoutResult['status'] = 'completed';

    if (def.kind === 'native') {
      // Direct native XLM payment.
      txHash = await stellar.sendPayment(sourceSecret, destination, String(amountNum), 'XLM', undefined, memoHash);
    } else {
      // Issued asset (USDC or local currency).
      // Try to auto-set up the trustline if we have the worker's secret (classic account).
      // If the worker is a SmartWallet (passkey) user, workerStoredSecret is null —
      // we'll attempt the path payment anyway; the contract may hold the trustline.
      if (workerStoredSecret) {
        const workerSecret = decryptFromString(workerStoredSecret);
        await stellar.ensureTrustline(workerSecret, def.code, def.issuer!);
      }

      try {
        const result = await stellar.payExactWithXlm(
          sourceSecret, destination, def.code, def.issuer!, String(amountNum), 0.05, memoHash,
        );
        txHash = result.hash;
        feePaidXlm = result.sourceAmountXlm;
      } catch (pathErr: any) {
        // If the destination lacks a trustline (op_no_trust / op_no_destination),
        // fall back to a claimable XLM balance the worker can claim when ready.
        const codes: string = JSON.stringify(
          pathErr?.response?.data?.extras?.result_codes ?? {},
        );
        const isNoTrust = codes.includes('op_no_trust') || codes.includes('op_no_destination');
        if (!isNoTrust) throw pathErr;

        logger.warn('Destination lacks trustline — creating claimable XLM balance', {
          paymentId, workerId, asset,
        });

        txHash = await stellar.createClaimableBalance(
          sourceSecret,
          destination,
          Asset.native(),
          String(amountNum),
          memoHash,
        );
        paymentStatus = 'pending_claim';
      }
    }

    await query(
      `UPDATE payments
          SET status = $1::text, stellar_tx_hash = $2, fee_paid_xlm = $3,
              completed_at = CASE WHEN $1::text = 'completed' THEN NOW() ELSE NULL END,
              updated_at = NOW()
        WHERE id = $4`,
      [paymentStatus, txHash, feePaidXlm, paymentId],
    );
    logger.info('Payment settled', { paymentId, txHash, status: paymentStatus, amount: amountNum, currency: asset, workerId });

    // Emit notifications (best-effort — never block the payment result)
    try {
      if (paymentStatus === 'completed') {
        await Promise.all([
          query(
            `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
             VALUES ($1, 'payment_completed', 'Payment sent', $2, 'payment', $3)`,
            [enterpriseId, `Payment of ${amountNum} ${asset} to ${workerEmail} was settled.`, paymentId],
          ),
          query(
            `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
             VALUES ($1, 'payment_received', 'Payment received', $2, 'payment', $3)`,
            [workerId, `You received ${amountNum} ${asset} from your employer.`, paymentId],
          ),
        ]);
      } else {
        // pending_claim
        await Promise.all([
          query(
            `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
             VALUES ($1, 'payment_pending_claim', 'Payment pending claim', $2, 'payment', $3)`,
            [enterpriseId, `Payment to ${workerEmail} is pending — they need to set up a trustline to receive ${asset}.`, paymentId],
          ),
          query(
            `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
             VALUES ($1, 'payment_pending_claim', 'Payment waiting for you', $2, 'payment', $3)`,
            [workerId, `A payment of ${amountNum} XLM is held for you. Set up your wallet to claim it.`, paymentId],
          ),
        ]);
      }
    } catch (notifErr) {
      logger.warn('Failed to emit payment notification', { paymentId, error: String(notifErr) });
    }

    return { ...base, paymentId, status: paymentStatus, stellarTxHash: txHash, ...(feePaidXlm ? { sourceAmountXlm: feePaidXlm } : {}) };
  } catch (err: any) {
    const resultCodes = err?.response?.data?.extras?.result_codes;
    const detail = resultCodes ? JSON.stringify(resultCodes) : (err instanceof Error ? err.message : String(err));
    await query(
      `UPDATE payments SET status = 'failed', failure_reason = $1, failed_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [detail, paymentId],
    );
    logger.error('Stellar payment failed', { paymentId, detail });

    try {
      await query(
        `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
         VALUES ($1, 'payment_failed', 'Payment failed', $2, 'payment', $3)`,
        [enterpriseId, `Payment of ${amountNum} ${asset} to ${workerEmail} failed: ${detail.slice(0, 120)}`, paymentId],
      );
    } catch (notifErr) {
      logger.warn('Failed to emit payment_failed notification', { paymentId, error: String(notifErr) });
    }

    return { ...base, paymentId, error: detail };
  }
}

/** Validate currency + load/decrypt the enterprise secret. Returns an error string or the secret. */
export async function resolveEnterpriseSecret(enterpriseId: string): Promise<{ secret?: string; error?: string }> {
  const entRes = await query('SELECT stellar_secret_key FROM users WHERE id = $1', [enterpriseId]);
  const stored: string | undefined = entRes.rows[0]?.stellar_secret_key;
  if (!stored) return { error: 'Enterprise Stellar account is not set up' };
  return { secret: decryptFromString(stored) };
}

/**
 * POST /payouts — single payout from enterprise to worker.
 *
 * Two modes:
 *  - Exact:  { workerId, amount, currency }     → deliver exactly `amount` of `currency`.
 *  - USD:    { workerId, amountUsd }             → employer sends USD; the worker
 *            receives their PREFERRED currency, converted at the live FX rate.
 */
app.post('/payouts', async (req, res) => {
  const { workerId, amount, amountUsd, currency, memo, idempotencyKey } = req.body as {
    enterpriseId?: string; workerId: string;
    amount?: number | string; amountUsd?: number | string; currency?: string; memo?: string;
    idempotencyKey?: string;
  };

  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;
  if (requesterRole !== 'enterprise' || !requesterId) return res.status(403).json({ error: 'Enterprise role required' });
  const ctx = await resolveCompanyContextOrSelf(requesterId, requesterRole);
  if (!ctx) return res.status(403).json({ error: 'You do not belong to a company' });
  if (!canMoveMoney(ctx.companyRole)) return res.status(403).json({ error: 'Only company owners and admins can send payments' });
  const enterpriseId = ctx.ownerUserId;
  if (!workerId) return res.status(400).json({ error: 'workerId is required' });

  // Resolve the destination asset + exact amount.
  let asset: string;
  let amountNum: number;
  let usdAmount: number | undefined;

  try {
    if (amountUsd != null) {
      // USD mode: derive the worker's preferred currency and convert.
      const usd = Number(amountUsd);
      if (!Number.isFinite(usd) || usd <= 0) return res.status(400).json({ error: 'amountUsd must be a positive number' });
      const wkr = await query('SELECT preferred_currency FROM users WHERE id = $1', [workerId]);
      asset = (wkr.rows[0]?.preferred_currency || 'USDC').toUpperCase();
      if (!isSupportedCurrency(asset)) return res.status(400).json({ error: `Worker preferred currency unsupported: ${asset}` });
      const rate = await usdToCurrencyRate(asset);          // local units per USD
      amountNum = Math.round(usd * rate * 1e7) / 1e7;        // exact local amount (7dp)
      usdAmount = usd;
    } else {
      // Exact mode.
      if (amount == null) return res.status(400).json({ error: 'Provide amountUsd, or amount + currency' });
      amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
      asset = String(currency || 'XLM').toUpperCase();
      if (!isSupportedCurrency(asset)) return res.status(400).json({ error: `Unsupported currency: ${asset}` });
    }
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }

  const { secret, error } = await resolveEnterpriseSecret(enterpriseId);
  if (error) return res.status(400).json({ error });

  const result = await executePayout({ enterpriseId, sourceSecret: secret!, workerId, amountNum, asset, memo, idempotencyKey });

  if (result.status === 'completed') {
    return res.status(201).json({
      paymentId: result.paymentId, status: 'completed', currency: result.currency, amount: result.amount,
      ...(usdAmount != null ? { usdAmount } : {}),
      stellarTxHash: result.stellarTxHash, ...(result.sourceAmountXlm ? { sourceAmountXlm: result.sourceAmountXlm } : {}),
    });
  }
  const code = result.httpStatus ?? (/not found/i.test(result.error ?? '') ? 404 : /kyc/i.test(result.error ?? '') ? 403 : 502);
  return res.status(code).json({ paymentId: result.paymentId, status: 'failed', error: result.error });
});

/**
 * POST /payouts/batch — pay many workers in one request.
 * Body: { enterpriseId, currency?, items: [{ workerId, amount, memo? }] }
 * Payments execute sequentially (one Stellar source account → one sequence).
 */
app.post('/payouts/batch', async (req, res) => {
  const { currency = 'XLM', items, idempotencyKey } = req.body as {
    enterpriseId?: string;
    currency?: string;
    items: Array<{ workerId: string; amount: number | string; memo?: string }>;
    idempotencyKey?: string;
  };

  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;
  if (requesterRole !== 'enterprise' || !requesterId) return res.status(403).json({ error: 'Enterprise role required' });
  const ctx = await resolveCompanyContextOrSelf(requesterId, requesterRole);
  if (!ctx) return res.status(403).json({ error: 'You do not belong to a company' });
  if (!canMoveMoney(ctx.companyRole)) return res.status(403).json({ error: 'Only company owners and admins can send payments' });
  const enterpriseId = ctx.ownerUserId;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
  if (items.length > 100) {
    return res.status(400).json({ error: 'A batch may contain at most 100 payments' });
  }
  const asset = String(currency || 'XLM').toUpperCase();
  if (!isSupportedCurrency(asset)) return res.status(400).json({ error: `Unsupported currency: ${asset}` });

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

  // ── Idempotency ────────────────────────────────────────────────────────────
  // Deliberately no item-level auto-resume of partial/failed batches — an
  // enterprise that wants to pay a failed subset submits a NEW batch (new key)
  // with just those workers. Keeps replay semantics simple and unambiguous.
  const batchPayloadHash = crypto.createHash('sha256')
    .update(JSON.stringify({ asset, items: normalized }))
    .digest('hex');

  if (idempotencyKey) {
    const existing = await query(
      `SELECT id, status, payload_hash FROM payment_batches WHERE enterprise_id = $1 AND idempotency_key = $2`,
      [enterpriseId, idempotencyKey],
    );
    const row = existing.rows[0];
    if (row) {
      if (row.payload_hash !== batchPayloadHash) {
        return res.status(422).json({ error: 'Idempotency key already used for a different batch request' });
      }
      if (row.status === 'processing') {
        return res.status(409).json({ error: 'Batch with this idempotency key is already being processed', batchId: row.id });
      }
      // Terminal (completed/partial/failed) — replay from ground truth, no re-execution.
      const cached = await query(
        `SELECT id AS "paymentId", worker_id AS "workerId", amount, currency, status,
                stellar_tx_hash AS "stellarTxHash", fee_paid_xlm AS "sourceAmountXlm"
           FROM payments WHERE batch_id = $1 ORDER BY created_at`,
        [row.id],
      );
      const cachedCompleted = cached.rows.filter((r: any) => r.status === 'completed');
      const cachedFailed = cached.rows.filter((r: any) => r.status === 'failed');
      return res.status(cachedFailed.length === 0 ? 201 : 207).json({
        batchId: row.id, status: row.status, currency: asset, totalRequested,
        completedCount: cachedCompleted.length, failedCount: cachedFailed.length, results: cached.rows,
      });
    }
  }

  // Create the batch record.
  let batchId: string;
  try {
    const batchRes = await query(
      `INSERT INTO payment_batches (enterprise_id, total_amount, payment_count, status, idempotency_key, payload_hash, heartbeat_at)
         VALUES ($1, $2, $3, 'processing', $4, $5, NOW()) RETURNING id`,
      [enterpriseId, totalRequested, normalized.length, idempotencyKey ?? null, idempotencyKey ? batchPayloadHash : null],
    );
    batchId = batchRes.rows[0].id as string;
  } catch (err: any) {
    if (err?.code === '23505' && idempotencyKey) {
      return res.status(409).json({ error: 'Batch with this idempotency key is already being processed' });
    }
    throw err;
  }

  // Execute sequentially (shared source account → strictly ordered sequence numbers).
  const results: PayoutResult[] = [];
  for (const item of normalized) {
    const r = await executePayout({
      enterpriseId, sourceSecret: secret!, workerId: item.workerId,
      amountNum: item.amountNum, asset, memo: item.memo, batchId,
    });
    results.push(r);
    // Heartbeat: lets the reconciliation watchdog tell "still legitimately
    // running" from "crashed" — without it, a large sequential batch is
    // indistinguishable from a dead one once enough time has passed.
    await query(`UPDATE payment_batches SET heartbeat_at = NOW() WHERE id = $1`, [batchId]);
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
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;

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
    // Only a member of the company that created the payment (and only
    // owner/admin, since this moves money) can submit the signature.
    if (!requesterId) return res.status(401).json({ error: 'Not authenticated' });
    const ctx = await resolveCompanyContextOrSelf(requesterId, requesterRole);
    if (!ctx || ctx.ownerUserId !== payment.enterprise_id) {
      return res.status(403).json({ error: 'Not authorized to submit signature for this payment' });
    }
    if (!canMoveMoney(ctx.companyRole)) {
      return res.status(403).json({ error: 'Only company owners and admins can submit payment signatures' });
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
 * GET /payouts — list payments for an enterprise or worker.
 */
app.get('/payouts', async (req, res) => {
  const { workerId, status, limit = '20', offset = '0' } = req.query;
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;

  // Scope strictly to the requester's company: an enterprise sees its
  // company's payments (optionally filtered by a specific worker); a worker
  // sees only their own.
  if ((requesterRole !== 'enterprise' && requesterRole !== 'worker') || !requesterId) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (requesterRole === 'enterprise') {
      const ctx = await resolveCompanyContextOrSelf(requesterId, requesterRole);
      if (!ctx) return res.status(403).json({ error: 'You do not belong to a company' });
      conditions.push(`enterprise_id = $${idx++}`); params.push(ctx.ownerUserId);
      if (workerId) { conditions.push(`worker_id = $${idx++}`); params.push(workerId); }
    } else {
      conditions.push(`worker_id = $${idx++}`); params.push(requesterId);
    }
    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }

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
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;

  // Enterprises see their company's payments; workers see their own.
  let scope: string;
  let scopeId: string;
  if (requesterRole === 'enterprise' && requesterId) {
    const ctx = await resolveCompanyContextOrSelf(requesterId, requesterRole);
    if (!ctx) return res.status(403).json({ error: 'You do not belong to a company' });
    scope = 'enterprise_id';
    scopeId = ctx.ownerUserId;
  } else if (requesterRole === 'worker' && requesterId) {
    scope = 'worker_id';
    scopeId = requesterId;
  } else {
    return res.status(403).json({ error: 'Not authorized' });
  }

  try {
    const [byStatus, byCurrencyRows] = await Promise.all([
      query(`SELECT status, COUNT(*) AS count FROM payments WHERE ${scope} = $1 GROUP BY status`, [scopeId]),
      // Completed volume per currency — different currencies cannot be summed
      // directly, so we aggregate per currency and convert each to USD.
      query(
        `SELECT currency, COALESCE(SUM(amount), 0) AS vol
           FROM payments WHERE ${scope} = $1 AND status = 'completed' GROUP BY currency`,
        [scopeId],
      ),
    ]);

    const total = byStatus.rows.reduce((s, r) => s + Number(r.count), 0);
    const completed = byStatus.rows.find((r) => r.status === 'completed');
    const successRate = total > 0 ? (Number(completed?.count ?? 0) / total) * 100 : 0;

    // Per-currency completed totals + a single USD-normalized total.
    const byCurrency: Record<string, number> = {};
    let completedVolumeUsd = 0;
    for (const row of byCurrencyRows.rows) {
      const code = String(row.currency);
      const vol = Number(row.vol);
      byCurrency[code] = vol;
      completedVolumeUsd += await amountToUsd(code, vol);
    }

    res.json({
      totalCount: total,
      successRate: Math.round(successRate * 10) / 10,
      byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, Number(r.count)])),
      byCurrency,
      completedVolumeUsd: Math.round(completedVolumeUsd * 100) / 100,
    });
  } catch (err) {
    logger.error('Summary failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /payouts/recent — last N payments for dashboard.
 */
app.get('/payouts/recent', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 10), 50);

  // Enterprises see their company's payments; workers see their own.
  let scopeColumn: string;
  let scopeId: string;
  if (requesterRole === 'enterprise' && requesterId) {
    const ctx = await resolveCompanyContextOrSelf(requesterId, requesterRole);
    if (!ctx) return res.status(403).json({ error: 'You do not belong to a company' });
    scopeColumn = 'p.enterprise_id';
    scopeId = ctx.ownerUserId;
  } else if (requesterRole === 'worker' && requesterId) {
    scopeColumn = 'p.worker_id';
    scopeId = requesterId;
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
      [scopeId, limit],
    );
    res.json({ payments: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /payouts/currencies — supported payout currencies (for UI selectors).
 * Registered before /payouts/:id so it isn't captured by the :id param.
 */
app.get('/payouts/currencies', (_req, res) => {
  res.json({ currencies: PAYOUT_CURRENCIES });
});

/**
 * GET /payouts/fx — live USD→currency rates for the supported payout currencies.
 * Lets the employer form preview the local amount a worker will receive.
 */
app.get('/payouts/fx', async (_req, res) => {
  try {
    const rates = await getUsdRates();
    const out: Record<string, number> = { USDC: 1 };
    for (const c of PAYOUT_CURRENCIES) {
      if (c.kind === 'local' && rates[c.code]) out[c.code] = rates[c.code];
    }
    res.json({ base: 'USD', rates: out });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch FX rates' });
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
 * GET /payouts/:id — full detail for a single payment (for the detail modal).
 */
app.get('/payouts/:id', async (req, res) => {
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;

  try {
    const result = await query(
      `SELECT p.id, p.enterprise_id, p.worker_id, p.amount, p.currency, p.status,
              p.stellar_tx_hash, p.stellar_destination, p.description AS memo,
              p.failure_reason, p.fee_paid_xlm, p.batch_id, p.idempotency_key,
              p.created_at, p.completed_at, p.failed_at, p.updated_at,
              w.email AS worker_email, e.email AS enterprise_email, comp.company_name
         FROM payments p
         LEFT JOIN users w ON w.id = p.worker_id
         LEFT JOIN users e ON e.id = p.enterprise_id
         LEFT JOIN enterprises comp ON comp.user_id = p.enterprise_id
        WHERE p.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

    const payment = result.rows[0];
    // Only the company (owner/admin/member) or worker involved can view this payment.
    let authorized = requesterId === payment.worker_id;
    if (!authorized && requesterRole === 'enterprise' && requesterId) {
      const ctx = await resolveCompanyContextOrSelf(requesterId, requesterRole);
      authorized = !!ctx && ctx.ownerUserId === payment.enterprise_id;
    }
    if (!authorized) {
      return res.status(403).json({ error: 'Not authorized to view this payment' });
    }

    // Enrich with USD value and (for issued currencies) the FX rate used.
    const usd = await amountToUsd(payment.currency, Number(payment.amount)).catch(() => 0);
    let fxRate: number | null = null;
    if (payment.currency !== 'XLM' && payment.currency !== 'USDC') {
      const rates = await getUsdRates().catch(() => ({} as Record<string, number>));
      fxRate = Number(rates[payment.currency]) || null;
    }

    res.json({
      ...payment,
      rail: 'stellar',
      usd_value: Math.round(usd * 100) / 100,
      fx_rate: fxRate, // units of `currency` per 1 USD (USDC = 1, XLM = null)
    });
  } catch (err) {
    logger.error('Payment detail failed', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
