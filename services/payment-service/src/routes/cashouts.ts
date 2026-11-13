import { Router, Request, Response, NextFunction } from 'express';
import type { Router as RouterType } from 'express';
import { query } from '@funti3r/database';
import { AppError, createLogger, decryptFromString } from '@funti3r/shared-utils';
import { Memo } from '@stellar/stellar-sdk';
import { HorizonRejectedError, SubmitOutcomeUnknownError, payExactWithXlm, spendableXlm, type OnSigned } from '../lib/stellar.js';
import { getCurrency } from '../lib/currencies.js';
import {
  checkDeposit, createSession, findClaimedTransaction, listTransactions,
  moneygramConfigured, moneygramPublicKey, moneygramSandbox,
} from '../lib/moneygram.js';
import { awaitRampsAcknowledgement } from '../lib/rampsSync.js';
import { ensureCleared } from '../lib/clearance.js';
import { cashoutsTotal } from '../lib/metrics.js';
import { audit } from '../lib/audit.js';
import { recoveryHold } from '../lib/recoveryHold.js';

// ── MoneyGram cash-out from the worker's wallet ───────────────────────────────
// 1) POST /cashouts/moneygram/session  opens a MoneyGram widget session. KYC, the amount, the
//    quote and the pickup location all happen inside MoneyGram's widget.
// 2) POST /cashouts/moneygram/deposit  is called when the widget asks for the deposit. The
//    browser's claim is checked against MoneyGram's own record before we pay.
// What can be cashed out is the wallet's spendable XLM, whichever milestone it came from.

const router: RouterType = Router();
const logger = createLogger('CashoutsRoute');

function requireWorker(req: Request, res: Response): string | null {
  const userId = req.headers['x-user-id'] as string | undefined;
  const role = req.headers['x-user-role'] as string | undefined;
  if (role !== 'worker' || !userId) {
    res.status(403).json({ error: 'Worker role required' });
    return null;
  }
  return userId;
}

async function workerPublicKey(workerId: string): Promise<string | undefined> {
  const r = await query(`SELECT stellar_public_key FROM users WHERE id = $1`, [workerId]);
  return r.rows[0]?.stellar_public_key;
}

router.post('/moneygram/session', recoveryHold, async (req: Request, res: Response, next: NextFunction) => {
  const workerId = requireWorker(req, res);
  if (!workerId) return;
  if (!moneygramConfigured()) return res.status(400).json({ error: 'MoneyGram cash-out is not configured' });

  try {
    const pub = await workerPublicKey(workerId);
    if (!pub) return res.status(400).json({ error: 'Your Stellar account is not set up' });
    const maxXlm = await spendableXlm(pub);
    if (maxXlm <= 0) return res.status(409).json({ error: 'There is no balance available to cash out' });
    await ensureCleared(workerId, pub);

    const session = await createSession({ customerIdentifier: workerId, walletAddress: pub });
    res.json({
      sessionToken: session.sessionToken,
      widgetUrl: session.widgetUrl,
      publicKey: moneygramPublicKey(),
      walletAddress: pub,
      // The most XLM this cash-out may ever spend: what the wallet can spare right now.
      maxXlm,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/moneygram/deposit', recoveryHold, async (req: Request, res: Response, next: NextFunction) => {
  const workerId = requireWorker(req, res);
  if (!workerId) return;
  if (!moneygramConfigured()) return res.status(400).json({ error: 'MoneyGram cash-out is not configured' });

  const b = (req.body ?? {}) as { address?: unknown; memo?: unknown; amount?: unknown };
  if (typeof b.address !== 'string' || !b.address || typeof b.memo !== 'string' || !b.memo
    || !['string', 'number'].includes(typeof b.amount) || !Number(b.amount)) {
    return res.status(400).json({ error: 'address, memo and amount are required' });
  }
  const claim = { address: b.address, memo: b.memo, amount: String(b.amount) };

  try {
    const pub = await workerPublicKey(workerId);
    if (!pub) return res.status(400).json({ error: 'Your Stellar account is not set up' });
    await ensureCleared(workerId, pub);

    // The browser is not trusted: MoneyGram's own record decides what we pay.
    const record = findClaimedTransaction(await listTransactions(), claim);
    const verdict = checkDeposit(record, { customerIdentifier: workerId, walletAddress: pub, claim });
    if (!verdict.ok) {
      cashoutsTotal.inc({ outcome: 'rejected' });
      return res.status(409).json({ error: verdict.reason, code: 'deposit_rejected' });
    }
    const tx = verdict.tx;

    // Idempotent: a repeated request after we already paid returns the same payment.
    const existing = await query(`SELECT worker_id, settlement_hash FROM cashouts WHERE mg_tx_id = $1`, [tx.id]);
    const prior = existing.rows[0];
    if (prior && prior.worker_id === workerId && prior.settlement_hash) {
      return res.json({ txHash: prior.settlement_hash, alreadyPaid: true });
    }

    const maxXlm = await spendableXlm(pub);
    if (maxXlm <= 0) return res.status(409).json({ error: 'There is no balance available to cash out' });

    // Take the cash-out. The unique MoneyGram transaction id means a forged or replayed request
    // can never pay one transaction twice. Only our own attempt that signed nothing can be taken again: a failed one,
    // or one cut off before signing (a crash). Two attempts racing for the same row are settled by recordIntent below,
    // which lets exactly one of them store a transaction and submit it.
    const taken = await query(
      `INSERT INTO cashouts (worker_id, mg_tx_id) VALUES ($1, $2)
       ON CONFLICT (mg_tx_id) DO UPDATE SET status = 'pending', error = NULL
         WHERE cashouts.worker_id = $1 AND cashouts.status IN ('failed', 'pending') AND cashouts.settlement_hash IS NULL
       RETURNING id`,
      [workerId, tx.id],
    );
    if (!taken.rows.length) return res.status(409).json({ error: 'This MoneyGram transaction was already used', code: 'deposit_rejected' });
    const cashoutId = taken.rows[0].id as string;

    // Write-ahead: the transaction's hash is stored before it is submitted, only if no other attempt stored one first.
    // From then on every retry answers "already paid", and the sweep (lib/rampsSync.ts) reads the chain's answer once
    // the time bound is over, whatever happens to this request.
    let signedHash: string | null = null;
    const recordIntent: OnSigned = async (txHash) => {
      const r = await query(
        `UPDATE cashouts SET settlement_hash = $2, settlement_unconfirmed_since = NOW()
          WHERE id = $1 AND status = 'pending' AND settlement_hash IS NULL RETURNING id`,
        [cashoutId, txHash],
      );
      if (!r.rows.length) throw new AppError(409, 'This MoneyGram transaction is already being paid', 'deposit_rejected');
      signedHash = txHash;
    };

    const stored = (await query(`SELECT stellar_secret_key FROM users WHERE id = $1`, [workerId])).rows[0]?.stellar_secret_key;
    let hash: string;
    let spentXlm: string;
    try {
      const usdc = getCurrency('USDC');
      if (!stored || !usdc?.issuer) throw new Error('USDC is not configured for this account');
      // Strict-receive: MoneyGram gets exactly the USDC it asked for, delivered straight to its
      // deposit address with its memo. sendMax is the wallet's spendable XLM, so the network itself
      // refuses to let this cash-out spend more than the wallet can spare.
      ({ hash, sourceAmountXlm: spentXlm } = await payExactWithXlm(
        decryptFromString(stored), tx.depositAddress!, usdc.code, usdc.issuer, claim.amount, 0, undefined,
        { sendMaxXlm: maxXlm.toFixed(7), memo: Memo.id(tx.depositMemo!), onSigned: recordIntent },
      ));
    } catch (err) {
      if (err instanceof SubmitOutcomeUnknownError) {
        // Not a failure: the payment may still land. Its hash is already stored (recordIntent), so every retry answers
        // "already paid" instead of paying MoneyGram a second time; the scheduled sweep reads the chain's answer once
        // the time bound is over (lib/rampsSync.ts) and fails the cash-out, retryable, only if it never landed.
        logger.warn('MoneyGram deposit submitted without a verdict; awaiting on-chain confirmation', { cashoutId, txHash: err.txHash });
        cashoutsTotal.inc({ outcome: 'submitted' });
        await audit({ actorId: workerId, actorRole: 'worker', action: 'cashout.submitted', entityType: 'cashout', entityId: cashoutId, detail: { usdc: claim.amount, txHash: err.txHash } });
        return res.status(202).json({ txHash: err.txHash, status: 'submitted' });
      }
      // Horizon's result codes say why (op_underfunded, ...); the client-facing message does not.
      const message = err instanceof HorizonRejectedError ? JSON.stringify(err.resultCodes) : err instanceof Error ? err.message : String(err);
      logger.error('MoneyGram deposit payment failed', { cashoutId, error: message });
      // Nothing was paid: Horizon refused this attempt's transaction, or the error came before submitting. The guard on
      // the hash means only this attempt's own row is failed, never one another attempt has since signed for.
      await query(
        `UPDATE cashouts SET status = 'failed', error = $2, settlement_hash = NULL, settlement_unconfirmed_since = NULL
          WHERE id = $1 AND status = 'pending' AND settlement_hash IS NOT DISTINCT FROM $3`,
        [cashoutId, message.slice(0, 500), signedHash],
      );
      cashoutsTotal.inc({ outcome: 'payment_failed' });
      await audit({ actorId: workerId, actorRole: 'worker', action: 'cashout.payment_failed', entityType: 'cashout', entityId: cashoutId, detail: { error: message.slice(0, 200) } });
      throw err;
    }

    // Confirmed by Horizon: no longer waiting for the chain's answer.
    await query(
      `UPDATE cashouts SET xlm_spent = $3, settlement_unconfirmed_since = NULL WHERE id = $1 AND settlement_hash = $2`,
      [cashoutId, hash, spentXlm],
    );
    // Answer now. MoneyGram takes up to a minute to acknowledge a payment, and the gateway cuts a
    // request off after 30s — waiting here made a successful payment look like a failure to the
    // browser. The acknowledgement is settled in the background (and by the scheduled sweep).
    void awaitRampsAcknowledgement(cashoutId, tx.id).catch((err) =>
      logger.warn('MoneyGram acknowledgement check failed', { cashoutId, error: String(err) }),
    );
    cashoutsTotal.inc({ outcome: 'paid' });
    await audit({ actorId: workerId, actorRole: 'worker', action: 'cashout.paid', entityType: 'cashout', entityId: cashoutId, detail: { usdc: claim.amount, xlmSpent: spentXlm, txHash: hash } });
    res.json({ txHash: hash, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

// ── GET /cashouts — the worker's own cash-out history ─────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const workerId = requireWorker(req, res);
  if (!workerId) return;
  try {
    const r = await query(
      `SELECT id, status, mg_status, settlement_hash, xlm_spent, send_usdc, reference_number, destination_country,
              receive_amount, receive_currency, fee, fee_currency, error, created_at, completed_at
         FROM cashouts WHERE worker_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [workerId],
    );
    const sandbox = moneygramSandbox();
    res.json({
      cashouts: r.rows.map((c) => ({
        id: c.id,
        status: c.status,
        mgStatus: c.mg_status ?? null,
        settlementHash: c.settlement_hash ?? null,
        xlmSpent: c.xlm_spent != null ? Number(c.xlm_spent) : null,
        sendUsdc: c.send_usdc ?? null,
        referenceNumber: c.reference_number ?? null,
        destinationCountry: c.destination_country ?? null,
        receiveAmount: c.receive_amount ?? null,
        receiveCurrency: c.receive_currency ?? null,
        fee: c.fee ?? null,
        feeCurrency: c.fee_currency ?? null,
        error: c.error ?? null,
        createdAt: c.created_at,
        completedAt: c.completed_at ?? null,
        sandbox,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
