import express from 'express';
import crypto from 'crypto';
import { AppError, createLogger, forwardedHeaders, retryRead, decryptFromString, NotFoundError, ExternalServiceError, errorHandler, requireGatewayIdentity, requestContext, registerHealth, parseBody, stellarNetwork } from '@funti3r/shared-utils';
import { ComplianceBlockedError } from './lib/clearance.js';
import { metrics, payoutsTotal } from './lib/metrics.js';
import { audit } from './lib/audit.js';
import { payoutBody, batchPayoutBody } from './lib/schemas.js';
import { query, getRedis } from '@funti3r/database';
import * as stellar from './lib/stellar.js';
import { notifyPaymentSettled } from './lib/paymentNotifications.js';
import { Asset } from '@stellar/stellar-sdk';
import { getCurrency, isSupportedCurrency, PAYOUT_CURRENCIES } from './lib/currencies.js';
import { usdToCurrencyRate, getUsdRates, amountToUsd, getXlmUsd, StaleRatesError } from './lib/fx.js';
import schedulesRouter from './routes/schedules.js';
import escrowsRouter from './routes/escrows.js';
import cashoutsRouter from './routes/cashouts.js';
import axios from 'axios';
import { resolveCompanyContext, resolveCompanyContextOrSelf, canMoveMoney, isCompanyWorker } from './lib/company.js';
import { recoveryHold } from './lib/recoveryHold.js';

const logger = createLogger('PaymentService');
const COMPLIANCE_SERVICE_URL = process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:3003';

const app: express.Express = express();
app.use(express.json());
app.use(requireGatewayIdentity());
app.use(requestContext('PaymentService', metrics.observeRequest));
app.get('/metrics', metrics.handler);

// ── Routers ───────────────────────────────────────────────────────────────────

app.use('/schedules', schedulesRouter);
app.use('/escrows', escrowsRouter);
app.use('/cashouts', cashoutsRouter);

// ── Health ────────────────────────────────────────────────────────────────────

// The database is essential; Redis only caches balances, and Stellar's Horizon is a third party whose outage should
// show up here without making this service refuse the requests that do not need it.
registerHealth(app, 'payment-service', {
  database: { critical: true, run: async () => { await query('SELECT 1'); } },
  redis: { critical: false, run: async () => { await (await getRedis()).ping(); } },
  horizon: {
    critical: false,
    run: async () => { await axios.get(stellarNetwork().horizonUrl, { timeout: 2500 }); },
  },
});

// ── Compliance guard ──────────────────────────────────────────────────────────

export async function requireCompliance(workerId: string): Promise<void> {
  try {
    const resp = await retryRead(() => axios.get(`${COMPLIANCE_SERVICE_URL}/${workerId}/status`, {
      timeout: 5000,
      headers: forwardedHeaders(),
    }));
    if (resp.data.status !== 'verified') {
      throw new ComplianceBlockedError('Worker KYC not verified');
    }
  } catch (err: unknown) {
    if (err instanceof ComplianceBlockedError) throw err;
    // Compliance service unreachable — fail safe
    logger.error('Compliance check failed — blocking payout', { workerId, error: err instanceof Error ? err.message : String(err) });
    throw new ExternalServiceError('Compliance', 'Compliance service unavailable', 'compliance_unavailable', { cause: err });
  }
}

// ── Wallet info ───────────────────────────────────────────────────────────────

/**
 * GET /wallets/company — the caller's COMPANY wallet (owner/admin/member all
 * see the same one, since custody is per-company, not per-login). Needed
 * because a teammate's own x-user-id never has a wallet of its own to show.
 */
app.get('/wallets/company', async (req, res, next) => {
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
    next(err);
  }
});

app.get('/wallets/:userId', async (req, res, next) => {
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
    next(err);
  }
});

// ── Payouts ───────────────────────────────────────────────────────────────────

export interface PayoutResult {
  paymentId?: string;
  /** The answer to a repeated request with the same idempotency key: nothing new happened, so nothing new is recorded. */
  replayed?: boolean;
  workerId: string;
  amount: number;
  currency: string;
  /** 'submitted': sent to Stellar without a verdict; the watchdog settles it from the chain (scheduler.ts). */
  status: 'completed' | 'pending_claim' | 'submitted' | 'failed';
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
async function executePayoutInner(opts: {
  enterpriseId: string;
  sourceSecret: string;
  workerId: string;
  amountNum: number;
  asset: string;
  memo?: string;
  batchId?: string | null;
  idempotencyKey?: string;
  /** Pre-resolved by a batch caller so N items don't each redo a compliance
   *  HTTP round-trip and a worker SELECT inside the sequential Stellar loop —
   *  when omitted (the single-payout path), executePayout resolves both itself.
   *  complianceError, when set, is the exact error to fail this item with
   *  (mirrors requireCompliance's two distinct messages: not-verified vs.
   *  compliance-service-unavailable) — undefined means verified. */
  precomputed?: {
    complianceError?: string;
    worker: {
      stellar_public_key?: string; stellar_secret_key?: string; email?: string;
    } | undefined;
  };
}): Promise<PayoutResult> {
  const { enterpriseId, sourceSecret, workerId, amountNum, asset, memo, batchId, idempotencyKey, precomputed } = opts;
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
          replayed: true,
        };
      }
      if (row.status === 'failed') {
        // Legitimate retry — atomic compare-and-swap, not check-then-update, so two
        // concurrent retries can't both resurrect the same row and double-submit.
        const cas = await query(
          `UPDATE payments SET status = 'initiated', failure_reason = NULL, stellar_tx_hash = NULL, tx_max_time = NULL, updated_at = NOW()
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
  if (precomputed) {
    if (precomputed.complianceError) {
      return { ...base, error: precomputed.complianceError };
    }
  } else {
    try {
      await requireCompliance(workerId);
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Worker destination (+ secret for trustline setup on issued assets).
  const workerRow = precomputed
    ? precomputed.worker
    : (await query('SELECT stellar_public_key, stellar_secret_key, email FROM users WHERE id = $1', [workerId])).rows[0];
  const destination: string | undefined = workerRow?.stellar_public_key;
  const workerEmail: string = workerRow?.email ?? 'your worker';
  const workerStoredSecret: string | undefined = workerRow?.stellar_secret_key;
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

  // Write-ahead: each transaction's hash and time bound are stored just before it is submitted, and only while the
  // row is still 'initiated'. Whatever happens next (a crash, a timeout, a lost database write), the watchdog knows
  // which transaction to look up and when the chain's answer is final; and a row the watchdog has already settled
  // can never be submitted for again.
  const recordIntent: stellar.OnSigned = async (hash, maxTime) => {
    const r = await query(
      `UPDATE payments SET stellar_tx_hash = $1, tx_max_time = $2, updated_at = NOW()
        WHERE id = $3 AND status = 'initiated' RETURNING id`,
      [hash, maxTime, paymentId],
    );
    if (r.rows.length === 0) throw new AppError(409, 'This payment is no longer pending', 'payment_not_pending');
  };

  // Submit to Stellar.
  const memoHash = crypto.createHash('sha256').update(paymentId).digest();
  let txHash: string;
  let feePaidXlm: string | null = null;
  let claimableXlm: string | null = null;
  let paymentStatus: 'completed' | 'pending_claim' = 'completed';
  try {
    if (def.kind === 'native') {
      // Direct native XLM payment.
      txHash = await stellar.sendPayment(sourceSecret, destination, String(amountNum), 'XLM', undefined, memoHash, recordIntent);
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
          sourceSecret, destination, def.code, def.issuer!, String(amountNum), 0.05, memoHash, { onSigned: recordIntent },
        );
        txHash = result.hash;
        // Despite the column name, payments.fee_paid_xlm holds the TOTAL XLM the
        // enterprise spent to fund this payout (the discovery-time path quote),
        // not the network fee.
        feePaidXlm = result.sourceAmountXlm;
      } catch (pathErr: any) {
        // If the destination lacks a trustline (op_no_trust / op_no_destination),
        // fall back to a claimable XLM balance the worker can claim when ready.
        // Horizon refused the path payment outright, so nothing landed; its stored hash is replaced below.
        const ops = pathErr instanceof stellar.HorizonRejectedError ? pathErr.resultCodes.operations ?? [] : [];
        const isNoTrust = ops.includes('op_no_trust') || ops.includes('op_no_destination');
        if (!isNoTrust) throw pathErr;

        // The claimable balance is XLM, but amountNum is denominated in `asset`
        // (e.g. NGN) — convert to the equivalent XLM so the worker gets the same
        // value, not the same number.
        const [usdValue, xlmUsd] = await Promise.all([
          amountToUsd(asset, amountNum),
          getXlmUsd(),
        ]);
        const xlmEquivalent = usdValue > 0 && xlmUsd > 0 ? (usdValue / xlmUsd).toFixed(7) : '0';
        if (Number(xlmEquivalent) <= 0) {
          throw new StaleRatesError(`The XLM price needed to hold ${amountNum} ${asset} for the worker`);
        }
        claimableXlm = xlmEquivalent;

        logger.warn('Destination lacks trustline — creating claimable XLM balance', {
          paymentId, workerId, asset, amountLocal: amountNum, claimableXlm,
        });

        txHash = await stellar.createClaimableBalance(
          sourceSecret,
          destination,
          Asset.native(),
          claimableXlm,
          memoHash,
          recordIntent,
        );
        paymentStatus = 'pending_claim';
      }
    }
  } catch (err: any) {
    if (err instanceof stellar.SubmitOutcomeUnknownError) {
      // Not a failure: the transaction may still land, and a 'failed' row would let a same-key retry pay twice.
      // 'submitted' makes retries answer 409 until the watchdog has read the outcome off the chain.
      await query(`UPDATE payments SET status = 'submitted', updated_at = NOW() WHERE id = $1 AND status = 'initiated'`, [paymentId]);
      logger.warn('Payment submitted without a verdict; awaiting on-chain confirmation', { paymentId, txHash: err.txHash, error: err.message });
      return { ...base, paymentId, status: 'submitted', httpStatus: 202 };
    }
    // Everything that reaches here means nothing was paid: Horizon refused the transaction, or the error came before
    // anything was submitted.
    const detail = err instanceof stellar.HorizonRejectedError
      ? JSON.stringify(err.resultCodes)
      : (err instanceof Error ? err.message : String(err));
    await query(
      `UPDATE payments SET status = 'failed', failure_reason = $1, failed_at = NOW(), updated_at = NOW()
        WHERE id = $2 AND status = 'initiated'`,
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

    // The full detail is stored and logged above; the caller gets it only when it is safe to show: Horizon's result
    // codes and our own client-facing messages are, anything else (a SQL or network error) is not.
    const clientError = err instanceof stellar.HorizonRejectedError ? detail
      : err instanceof AppError ? err.message
      : 'The payment could not be completed';
    return { ...base, paymentId, error: clientError };
  }

  // The money has moved. Nothing from here on may record this payment as failed: if the write below is lost, the row
  // keeps its stored hash and the watchdog settles it from the chain once the time bound has passed.
  try {
    const settled = await query(
      `UPDATE payments
          SET status = $1::text, stellar_tx_hash = $2, fee_paid_xlm = $3,
              completed_at = CASE WHEN $1::text = 'completed' THEN NOW() ELSE NULL END,
              updated_at = NOW()
        WHERE id = $4 AND status IN ('initiated', 'submitted') RETURNING id`,
      [paymentStatus, txHash, feePaidXlm, paymentId],
    );
    if (settled.rows.length === 0) logger.warn('Payment was already settled elsewhere', { paymentId, txHash });
  } catch (err) {
    logger.error('Payment landed but could not be recorded; the watchdog will settle it from the chain', { paymentId, txHash, error: String(err) });
    return { ...base, paymentId, status: 'submitted', stellarTxHash: txHash, httpStatus: 202 };
  }
  logger.info('Payment settled', { paymentId, txHash, status: paymentStatus, amount: amountNum, currency: asset, workerId });

  await notifyPaymentSettled({ paymentId, enterpriseId, workerId, workerEmail, amount: amountNum, asset, status: paymentStatus, claimableXlm });

  return { ...base, paymentId, status: paymentStatus, stellarTxHash: txHash, ...(feePaidXlm ? { sourceAmountXlm: feePaidXlm } : {}) };
}

/** Validate currency + load/decrypt the enterprise secret. Returns an error string or the secret. */
export async function resolveEnterpriseSecret(enterpriseId: string): Promise<{ secret?: string; error?: string }> {
  const entRes = await query('SELECT stellar_secret_key FROM users WHERE id = $1', [enterpriseId]);
  const stored: string | undefined = entRes.rows[0]?.stellar_secret_key;
  if (!stored) return { error: 'Enterprise Stellar account is not set up' };
  return { secret: decryptFromString(stored) };
}

/** Runs a payout and counts how it ended, so failed payouts show up on a dashboard and in alerts. */
export async function executePayout(opts: Parameters<typeof executePayoutInner>[0]): Promise<PayoutResult> {
  const result = await executePayoutInner(opts);
  if (result.replayed) return result;
  payoutsTotal.inc({ status: result.status });
  if (result.paymentId) {
    await audit({
      actorId: opts.enterpriseId, actorRole: 'enterprise', action: `payout.${result.status}`, entityType: 'payment', entityId: result.paymentId,
      detail: { workerId: opts.workerId, amount: result.amount, currency: result.currency, ...(result.stellarTxHash && { txHash: result.stellarTxHash }), ...(result.error && { error: result.error.slice(0, 200) }) },
    });
  }
  return result;
}

/**
 * POST /payouts — single payout from enterprise to worker.
 *
 * Two modes:
 *  - Exact:  { workerId, amount, currency }     → deliver exactly `amount` of `currency`.
 *  - USD:    { workerId, amountUsd }             → employer sends USD; the worker
 *            receives their PREFERRED currency, converted at the live FX rate.
 */
app.post('/payouts', recoveryHold, async (req, res, next) => {
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;
  if (requesterRole !== 'enterprise' || !requesterId) return res.status(403).json({ error: 'Enterprise role required' });
  const ctx = await resolveCompanyContextOrSelf(requesterId, requesterRole);
  if (!ctx) return res.status(403).json({ error: 'You do not belong to a company' });
  if (!canMoveMoney(ctx.companyRole)) return res.status(403).json({ error: 'Only company owners and admins can send payments' });
  const enterpriseId = ctx.ownerUserId;
  // After the permission checks, so someone who may not pay anyone gets a 403 whatever they sent.
  const body = parseBody(payoutBody, req.body, res);
  if (!body) return;
  const { workerId, amount, amountUsd, currency, memo, idempotencyKey } = body;

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
    return next(err); // input mistakes were answered above; stale FX rates are a 503, anything else a 500
  }

  const { secret, error } = await resolveEnterpriseSecret(enterpriseId);
  if (error) return res.status(400).json({ error });

  const result = await executePayout({ enterpriseId, sourceSecret: secret!, workerId, amountNum, asset, memo, idempotencyKey });

  // pending_claim moved money too (a claimable balance), so it is a success, not an error a client would retry.
  // submitted (202) is in flight: the client keeps its idempotency key and the payment settles on its own.
  if (result.status !== 'failed') {
    return res.status(result.status === 'submitted' ? 202 : 201).json({
      paymentId: result.paymentId, status: result.status, currency: result.currency, amount: result.amount,
      ...(usdAmount != null ? { usdAmount } : {}),
      stellarTxHash: result.stellarTxHash, ...(result.sourceAmountXlm ? { sourceAmountXlm: result.sourceAmountXlm } : {}),
    });
  }
  const code = result.httpStatus ?? (/not found/i.test(result.error ?? '') ? 404 : /kyc/i.test(result.error ?? '') ? 403 : 502);
  return res.status(code).json({ paymentId: result.paymentId, status: 'failed', error: result.error });
});

export interface BatchItem { workerId: string; amountUsd: number; memo?: string }

const reply = (httpStatus: number, body: Record<string, unknown>) => ({ httpStatus, body });

/**
 * Runs a validated batch for an enterprise and returns the HTTP answer. Shared by POST /payouts/batch and the payroll
 * scheduler, which calls it in-process: no HTTP timeout can then record a still-running batch as failed.
 */
export async function runBatchPayout(
  enterpriseId: string,
  normalized: BatchItem[],
  idempotencyKey?: string,
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const { secret, error } = await resolveEnterpriseSecret(enterpriseId);
  if (error) return reply(400, { error });

  const totalRequested = normalized.reduce((s, i) => s + i.amountUsd, 0);

  // ── Idempotency ────────────────────────────────────────────────────────────
  // Deliberately no item-level auto-resume of partial/failed batches — an
  // enterprise that wants to pay a failed subset submits a NEW batch (new key)
  // with just those workers. Keeps replay semantics simple and unambiguous.
  const batchPayloadHash = crypto.createHash('sha256')
    .update(JSON.stringify({ items: normalized }))
    .digest('hex');

  if (idempotencyKey) {
    const existing = await query(
      `SELECT id, status, payload_hash FROM payment_batches WHERE enterprise_id = $1 AND idempotency_key = $2`,
      [enterpriseId, idempotencyKey],
    );
    const row = existing.rows[0];
    if (row) {
      if (row.payload_hash !== batchPayloadHash) {
        return reply(422, { error: 'Idempotency key already used for a different batch request' });
      }
      if (row.status === 'processing') {
        return reply(409, { error: 'Batch with this idempotency key is already being processed', batchId: row.id });
      }
      // Terminal (completed/partial/failed) — replay from ground truth, no re-execution.
      const cached = await query(
        `SELECT id AS "paymentId", worker_id AS "workerId", amount, currency, status,
                stellar_tx_hash AS "stellarTxHash", fee_paid_xlm AS "sourceAmountXlm"
           FROM payments WHERE batch_id = $1 ORDER BY created_at`,
        [row.id],
      );
      // pending_claim moved the money too (a claimable balance); submitted is still awaiting the chain's answer.
      const cachedCompleted = cached.rows.filter((r: any) => r.status === 'completed' || r.status === 'pending_claim');
      const cachedFailed = cached.rows.filter((r: any) => r.status === 'failed');
      const cachedSubmitted = cached.rows.filter((r: any) => r.status === 'submitted' || r.status === 'initiated');
      return reply(cachedFailed.length === 0 && cachedSubmitted.length === 0 ? 201 : 207, {
        batchId: row.id, status: row.status, totalRequested,
        completedCount: cachedCompleted.length, failedCount: cachedFailed.length, submittedCount: cachedSubmitted.length,
        results: cached.rows,
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
      return reply(409, { error: 'Batch with this idempotency key is already being processed' });
    }
    throw err;
  }

  // Resolve compliance + worker rows for every item ONCE, up front — the
  // Stellar submission loop below must stay sequential (shared source account
  // → strictly ordered sequence numbers), but neither of these lookups needs
  // to be inside that per-item critical path (was previously one HTTP call to
  // compliance-service and one Postgres SELECT per item, i.e. up to 2×100
  // round-trips for a full batch).
  const workerIds = normalized.map((i) => i.workerId);
  const complianceErrorByWorker: Record<string, string | undefined> = {};
  try {
    // POST, but a read: a status lookup for many workers at once.
    const complianceResp = await retryRead(() => axios.post(
      `${COMPLIANCE_SERVICE_URL}/status/bulk`,
      { userIds: workerIds },
      { timeout: 10000, headers: forwardedHeaders() },
    ));
    const statuses = complianceResp.data?.statuses ?? {};
    for (const id of workerIds) {
      complianceErrorByWorker[id] = statuses[id]?.status === 'verified' ? undefined : 'Worker KYC not verified';
    }
  } catch (err) {
    // Compliance service unreachable — fail safe, block every item (mirrors
    // requireCompliance's own catch-all behavior for the single-payout path).
    logger.error('Bulk compliance check failed — blocking batch', { error: String(err) });
    for (const id of workerIds) complianceErrorByWorker[id] = 'Compliance service unavailable';
  }

  const workersRes = await query(
    'SELECT id, stellar_public_key, stellar_secret_key, email, preferred_currency FROM users WHERE id = ANY($1::uuid[])',
    [workerIds],
  );
  const workerById = new Map(workersRes.rows.map((w) => [w.id, w]));

  // Execute sequentially (shared source account → strictly ordered sequence
  // numbers). Each item resolves its OWN destination currency from the
  // worker's preferred_currency (same USD-mode resolution POST /payouts uses)
  // — a batch is no longer one shared currency for every recipient.
  const results: PayoutResult[] = [];
  for (const item of normalized) {
    const worker = workerById.get(item.workerId);
    const asset = (worker?.preferred_currency || 'USDC').toUpperCase();
    let r: PayoutResult;
    if (!isSupportedCurrency(asset)) {
      r = { workerId: item.workerId, amount: item.amountUsd, currency: 'USD', status: 'failed', error: `Worker preferred currency unsupported: ${asset}` };
    } else {
      try {
        const rate = await usdToCurrencyRate(asset);
        const amountNum = Math.round(item.amountUsd * rate * 1e7) / 1e7;
        r = await executePayout({
          enterpriseId, sourceSecret: secret!, workerId: item.workerId,
          amountNum, asset, memo: item.memo, batchId,
          precomputed: {
            complianceError: complianceErrorByWorker[item.workerId],
            worker,
          },
        });
      } catch (err) {
        r = { workerId: item.workerId, amount: item.amountUsd, currency: 'USD', status: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
    }
    results.push(r);
    // Heartbeat: lets the reconciliation watchdog tell "still legitimately
    // running" from "crashed" — without it, a large sequential batch is
    // indistinguishable from a dead one once enough time has passed.
    await query(`UPDATE payment_batches SET heartbeat_at = NOW() WHERE id = $1`, [batchId]);
  }

  const completed = results.filter((r) => r.status === 'completed');
  const failed = results.filter((r) => r.status === 'failed');
  const submitted = results.filter((r) => r.status === 'submitted');
  // With payments still awaiting their on-chain verdict the batch stays 'processing'; the watchdog finalizes it once
  // they are settled (scheduler.ts).
  const batchStatus = submitted.length > 0 ? 'processing'
    : failed.length === 0 ? 'completed' : completed.length === 0 ? 'failed' : 'partial';

  // Sum USD (not raw amounts, which can now be in different currencies per item).
  const completedUsdTotal = normalized.reduce(
    (sum, item, i) => (results[i].status === 'completed' ? sum + item.amountUsd : sum),
    0,
  );
  await query(
    `UPDATE payment_batches SET status = $1, total_amount = $2, updated_at = NOW() WHERE id = $3`,
    [batchStatus, completedUsdTotal, batchId],
  );

  logger.info('Batch payout finished', { batchId, status: batchStatus, completed: completed.length, failed: failed.length, submitted: submitted.length });
  return reply(failed.length === 0 && submitted.length === 0 ? 201 : 207, {
    batchId,
    status: batchStatus,
    totalRequested,
    completedCount: completed.length,
    failedCount: failed.length,
    submittedCount: submitted.length,
    results,
  });
}

/**
 * POST /payouts/batch — pay many workers in one request.
 * Body: { items: [{ workerId, amountUsd, memo? }] }
 * Each worker is paid in THEIR OWN preferred_currency, converted from
 * amountUsd at the live FX rate — same USD-mode behavior as POST /payouts,
 * just per-item. Payments execute sequentially (one Stellar source account →
 * one sequence number), but each item's destination currency is independent.
 */
app.post('/payouts/batch', recoveryHold, async (req, res, next) => {
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;
  if (requesterRole !== 'enterprise' || !requesterId) return res.status(403).json({ error: 'Enterprise role required' });
  const ctx = await resolveCompanyContextOrSelf(requesterId, requesterRole);
  if (!ctx) return res.status(403).json({ error: 'You do not belong to a company' });
  if (!canMoveMoney(ctx.companyRole)) return res.status(403).json({ error: 'Only company owners and admins can send payments' });
  const enterpriseId = ctx.ownerUserId;

  const body = parseBody(batchPayoutBody, req.body, res);
  if (!body) return;
  const { items, idempotencyKey } = body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
  if (items.length > 100) {
    return res.status(400).json({ error: 'A batch may contain at most 100 payments' });
  }

  // Validate every item up front. Each worker receives their own preferred
  // currency (resolved per-item below, same as the single-payout USD mode)
  // — no shared currency for the whole batch.
  const normalized: BatchItem[] = [];
  for (const it of items) {
    const amountUsd = Number(it.amountUsd);
    if (!it.workerId || !Number.isFinite(amountUsd) || amountUsd <= 0) {
      return res.status(400).json({ error: 'Each item needs a workerId and a positive amountUsd' });
    }
    normalized.push({ workerId: it.workerId, amountUsd, memo: it.memo });
  }

  try {
    const r = await runBatchPayout(enterpriseId, normalized, idempotencyKey);
    res.status(r.httpStatus).json(r.body);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /payouts — list payments for an enterprise or worker.
 */
app.get('/payouts', async (req, res, next) => {
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
      `SELECT id, enterprise_id, worker_id, amount, currency, status, rail, provider_reference,
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
    next(err);
  }
});

/**
 * GET /payouts/summary — dashboard aggregate stats.
 */
app.get('/payouts/summary', async (req, res, next) => {
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
    next(err);
  }
});

/**
 * GET /payouts/recent — last N payments for dashboard.
 */
app.get('/payouts/recent', async (req, res, next) => {
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
              e.email AS enterprise_email, comp.company_name,
              p.amount, p.currency, p.status, 'stellar' AS rail, p.stellar_tx_hash,
              p.created_at, p.updated_at
         FROM payments p
         LEFT JOIN users u ON u.id = p.worker_id
         LEFT JOIN users e ON e.id = p.enterprise_id
         LEFT JOIN enterprises comp ON comp.user_id = p.enterprise_id
         WHERE ${scopeColumn} = $1
         ORDER BY p.created_at DESC
         LIMIT $2`,
      [scopeId, limit],
    );
    res.json({ payments: result.rows });
  } catch (err) {
    next(err);
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
app.get('/payouts/fx', async (_req, res, next) => {
  try {
    const rates = await getUsdRates();
    const out: Record<string, number> = { USDC: 1 };
    for (const c of PAYOUT_CURRENCIES) {
      if (c.kind === 'local' && rates[c.code]) out[c.code] = rates[c.code];
    }
    res.json({ base: 'USD', rates: out });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /payouts/xlm-price — current XLM→USD price (CoinGecko), cached 5 min.
 * Registered before /payouts/:id so it isn't captured by the :id param.
 * Delegates to lib/fx.ts's getXlmUsd() (used elsewhere for amountToUsd
 * conversions) instead of keeping a second, independent 5-minute cache of
 * the same CoinGecko price.
 */
app.get('/payouts/xlm-price', async (_req, res, next) => {
  try {
    res.json({ usd: await getXlmUsd() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /payouts/:id — full detail for a single payment (for the detail modal).
 */
app.get('/payouts/:id', async (req, res, next) => {
  const requesterId = req.headers['x-user-id'] as string | undefined;
  const requesterRole = req.headers['x-user-role'] as string | undefined;

  try {
    const result = await query(
      `SELECT p.id, p.enterprise_id, p.worker_id, p.amount, p.currency, p.status,
              p.stellar_tx_hash, p.stellar_destination, p.description AS memo,
              p.failure_reason, p.fee_paid_xlm, p.batch_id, p.idempotency_key,
              p.rail, p.provider_reference,
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
    next(err);
  }
});

// Last, after every route: the one place a thrown error becomes a response.
app.use(errorHandler(logger));

export default app;
