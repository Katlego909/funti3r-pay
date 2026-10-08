/**
 * Anchor disbursement rail — routes a payout through a Stellar anchor
 * (bank deposit / cash pickup) instead of the worker's on-chain wallet.
 *
 * Wraps the SEP flow proven by scripts/anchor-e2e.ts: SEP-10 auth →
 * SEP-12 KYC (with the anchor's follow-up-fields round-trip) → SEP-6
 * withdraw → on-chain settlement payment with the anchor's memo → status.
 * Probes SEP-31 first on anchors that enable it; the reference anchor
 * currently serves SEP-6 only.
 */
import { createLogger } from '@funti3r/shared-utils';
import { Keypair } from '@stellar/stellar-sdk';
import {
  AnchorAmountMismatchError,
  type AnchorProtocol,
  anchorGetTransaction,
  anchorHomeDomain,
  anchorMemo,
  anchorProtocol,
  sep10Auth,
  sep24AwaitSettlementDetails,
  sep24WithdrawInfo,
  sep24WithdrawInteractive,
  sep12PutCustomer,
  sep6AwaitSettlementDetails,
  sep6Withdraw,
  sep6WithdrawInfo,
} from '../lib/anchor.js';
import { autofillReferenceForm } from '../lib/anchorReferenceUi.js';
import { sendPayment } from '../lib/stellar.js';

const logger = createLogger('Rail:Anchor');

export function anchorConfigured(): boolean {
  return !!process.env.ANCHOR_HOME_DOMAIN;
}

/** Demo-safe fallbacks for KYC fields the worker hasn't provided (testnet). */
function defaultKycValue(name: string, spec: { choices?: string[] }): string {
  return (
    spec.choices?.[0] ??
    (/birth_date/.test(name) ? '1990-01-01'
      : /expiration/.test(name) ? '2030-01-15'
      : /_date/.test(name) ? '2020-01-15'
      : /country/.test(name) ? 'USA'
      : /email/.test(name) ? 'worker@funti3r.xyz'
      : /routing|bank_number/.test(name) ? '121122676'
      : '123456789')
  );
}

/** What the anchor reports it pays out for a completed cash-out. */
export interface AnchorReceipt {
  amountOut?: string;
  amountOutAsset?: string;
  fee?: string;
  feeAsset?: string;
}

export interface AnchorPayoutResult {
  settlementHash: string;
  anchorTxId: string;
  anchorStatus: string;
  receipt?: AnchorReceipt;
}

/**
 * Disburse `amountXlm` through the configured anchor on behalf of a worker.
 * `kyc` comes from users.payout_details; missing fields fall back to demo
 * values (acceptable on testnet — a production anchor would reject them,
 * which is the correct fail-loud behavior).
 */
export async function sendAnchorPayout(opts: {
  payerSecret: string;
  amountXlm: string;
  kyc: Record<string, string>;
  /**
   * Continue an earlier attempt instead of starting a new anchor transaction.
   * With `settlementHash` the on-chain payment already happened, so it is
   * NEVER repeated — only the anchor status is re-read.
   */
  resume?: { anchorTxId: string; protocol?: AnchorProtocol; settlementHash?: string; interactiveUrl?: string };
  /** Called as soon as the anchor transaction exists (before any money moves). */
  onWithdrawCreated?: (anchorTxId: string, protocol: AnchorProtocol, interactiveUrl?: string) => Promise<void>;
  /** Called immediately after the on-chain settlement payment lands. */
  onSettled?: (settlementHash: string) => Promise<void>;
}): Promise<AnchorPayoutResult> {
  if (!anchorConfigured()) {
    throw new Error('No disbursement anchor is configured (ANCHOR_HOME_DOMAIN)');
  }

  const jwt = await sep10Auth(opts.payerSecret);

  let anchorTxId: string;
  let protocol: AnchorProtocol;
  let interactiveUrl: string | undefined;
  let settlementHash: string;
  if (opts.resume) {
    anchorTxId = opts.resume.anchorTxId;
    protocol = opts.resume.protocol ?? 'sep6';
    if (opts.resume.settlementHash) {
      settlementHash = opts.resume.settlementHash;
    } else {
      interactiveUrl = opts.resume.interactiveUrl;
      settlementHash = await settleWithAnchor(jwt, protocol, anchorTxId, interactiveUrl, opts);
    }
  } else {
    const started = await startWithdrawal(jwt, opts);
    anchorTxId = started.id;
    protocol = started.protocol;
    interactiveUrl = started.interactiveUrl;
    await opts.onWithdrawCreated?.(anchorTxId, protocol, interactiveUrl);
    settlementHash = await settleWithAnchor(jwt, protocol, anchorTxId, interactiveUrl, opts);
  }

  // Give the anchor a short window to confirm; the settlement is already
  // on-chain either way, and the anchor tx id stays queryable.
  let anchorStatus = 'pending_anchor';
  let receipt: AnchorReceipt | undefined;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await anchorGetTransaction(protocol, jwt, anchorTxId);
    anchorStatus = s.status;
    receipt = { amountOut: s.amountOut, amountOutAsset: s.amountOutAsset, fee: s.amountFee, feeAsset: s.amountFeeAsset };
    if (['completed', 'error', 'refunded'].includes(anchorStatus)) break;
  }

  logger.info('Anchor payout settled', {
    anchor: anchorHomeDomain(), anchorTxId, settlementHash, anchorStatus,
  });
  return { settlementHash, anchorTxId, anchorStatus, receipt };
}

/** SEP-12 KYC + withdraw request on the preferred protocol; returns the anchor transaction. */
async function startWithdrawal(
  jwt: string,
  opts: { payerSecret: string; amountXlm: string; kyc: Record<string, string> },
): Promise<{ id: string; protocol: AnchorProtocol; interactiveUrl?: string }> {
  // Register the customer with EVERY field we know up front (not just
  // name/email). The reference anchor otherwise leaves a repeat payer's
  // withdrawal stuck at `incomplete` — it won't re-prompt a customer it
  // already knows, so anything we didn't supply the first time never gets
  // asked for again. `payout_type` is a SEP-6 concept, not a SEP-12 field.
  const { payout_type: _pt, ...kycFields } = opts.kyc;
  const customerId = await sep12PutCustomer(jwt, {
    first_name: opts.kyc.first_name ?? 'Funti3r',
    last_name: opts.kyc.last_name ?? 'Worker',
    ...kycFields,
  });

  const protocol = await anchorProtocol();
  if (protocol === 'sep24') {
    const info = (await sep24WithdrawInfo()).find((a) => a.code === 'native');
    if (!info) throw new Error(`Anchor ${anchorHomeDomain()} does not offer native XLM withdrawals`);
    const amt = Number(opts.amountXlm);
    if (info.minAmount && amt < info.minAmount) {
      throw new Error(`Anchor minimum disbursement is ${info.minAmount} XLM (payout is ${opts.amountXlm})`);
    }
    if (info.maxAmount && amt > info.maxAmount) {
      throw new Error(`Anchor maximum disbursement is ${info.maxAmount} XLM (payout is ${opts.amountXlm})`);
    }
    const wd24 = await sep24WithdrawInteractive(jwt, {
      assetCode: 'native',
      account: Keypair.fromSecret(opts.payerSecret).publicKey(),
      amount: opts.amountXlm,
      customerId,
      prefill: kycFields,
    });
    logger.info('Anchor withdrawal created', { anchorTxId: wd24.id, protocol });

    // The SDF reference anchor ignores prefill and shows a blank form; on testnet
    // (opt-in) submit it for the worker from their saved details. Best effort —
    // if it doesn't take, the normal "complete the anchor form" step still applies.
    await autofillReferenceForm({ interactiveUrl: wd24.url, amountXlm: opts.amountXlm, details: opts.kyc });
    return { id: wd24.id, protocol, interactiveUrl: wd24.url };
  }

  const assets = await sep6WithdrawInfo();
  const native = assets.find((a) => a.code === 'native');
  if (!native) {
    throw new Error(`Anchor ${anchorHomeDomain()} does not offer native XLM withdrawals`);
  }
  const amount = Number(opts.amountXlm);
  if (native.minAmount && amount < native.minAmount) {
    throw new Error(`Anchor minimum disbursement is ${native.minAmount} XLM (payout is ${opts.amountXlm})`);
  }
  if (native.maxAmount && amount > native.maxAmount) {
    throw new Error(`Anchor maximum disbursement is ${native.maxAmount} XLM (payout is ${opts.amountXlm})`);
  }

  const type = opts.kyc.payout_type && native.types.includes(opts.kyc.payout_type)
    ? opts.kyc.payout_type
    : native.types[0];

  const wd = await sep6Withdraw(jwt, {
    assetCode: 'native',
    type,
    amount: opts.amountXlm,
    dest: opts.kyc.bank_account_number ?? '123456789',
  });
  logger.info('Anchor withdrawal created', { anchorTxId: wd.id, type, protocol });
  return { id: wd.id, protocol };
}

/**
 * Waits for the anchor's settlement details, then sends the on-chain payment
 * with the anchor's memo. Throws AnchorActionRequiredError when the anchor is
 * waiting on the user's own web step.
 */
async function settleWithAnchor(
  jwt: string,
  protocol: AnchorProtocol,
  anchorTxId: string,
  interactiveUrl: string | undefined,
  opts: { payerSecret: string; amountXlm: string; kyc: Record<string, string>; onSettled?: (hash: string) => Promise<void> },
): Promise<string> {
  const settle: { accountId: string; memoType: string; memo: string; amountIn?: string } = protocol === 'sep24'
    ? await sep24AwaitSettlementDetails(jwt, anchorTxId, interactiveUrl)
    : await sep6AwaitSettlementDetails(
      jwt, anchorTxId, (name, spec) => opts.kyc[name] ?? defaultKycValue(name, spec),
    );
  // The user types the amount into the anchor's own form. Paying anything but
  // exactly what the anchor recorded either strands funds or gets refunded, so
  // fail loudly BEFORE any money moves.
  if (settle.amountIn && Number(settle.amountIn) !== Number(opts.amountXlm)) {
    throw new AnchorAmountMismatchError(opts.amountXlm, settle.amountIn);
  }
  const settlementHash = await sendPayment(
    opts.payerSecret,
    settle.accountId,
    opts.amountXlm,
    'XLM',
    undefined,
    anchorMemo(settle.memoType, settle.memo),
  );
  // Persist immediately: from here on a retry must never pay the anchor again.
  await opts.onSettled?.(settlementHash);
  return settlementHash;
}
