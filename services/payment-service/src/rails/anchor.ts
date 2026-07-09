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
import {
  anchorHomeDomain,
  anchorMemo,
  sep10Auth,
  sep12PutCustomer,
  sep6AwaitSettlementDetails,
  sep6GetTransaction,
  sep6Withdraw,
  sep6WithdrawInfo,
} from '../lib/anchor.js';
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

export interface AnchorPayoutResult {
  settlementHash: string;
  anchorTxId: string;
  anchorStatus: string;
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
}): Promise<AnchorPayoutResult> {
  if (!anchorConfigured()) {
    throw new Error('No disbursement anchor is configured (ANCHOR_HOME_DOMAIN)');
  }

  const jwt = await sep10Auth(opts.payerSecret);
  // Register the customer with EVERY field we know up front (not just
  // name/email). The reference anchor otherwise leaves a repeat payer's
  // withdrawal stuck at `incomplete` — it won't re-prompt a customer it
  // already knows, so anything we didn't supply the first time never gets
  // asked for again. `payout_type` is a SEP-6 concept, not a SEP-12 field.
  const { payout_type: _pt, ...kycFields } = opts.kyc;
  await sep12PutCustomer(jwt, {
    first_name: opts.kyc.first_name ?? 'Funti3r',
    last_name: opts.kyc.last_name ?? 'Worker',
    ...kycFields,
  });

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

  const settle = wd.accountId
    ? { accountId: wd.accountId, memoType: wd.memoType, memo: wd.memo }
    : await sep6AwaitSettlementDetails(jwt, wd.id, (name, spec) => opts.kyc[name] ?? defaultKycValue(name, spec));

  const settlementHash = await sendPayment(
    opts.payerSecret,
    settle.accountId,
    opts.amountXlm,
    'XLM',
    undefined,
    anchorMemo(settle.memoType, settle.memo),
  );

  // Give the anchor a short window to confirm; the settlement is already
  // on-chain either way, and the anchor tx id stays queryable.
  let anchorStatus = 'pending_anchor';
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await sep6GetTransaction(jwt, wd.id);
    anchorStatus = s.status;
    if (['completed', 'error', 'refunded'].includes(anchorStatus)) break;
  }

  logger.info('Anchor payout settled', {
    anchor: anchorHomeDomain(), anchorTxId: wd.id, settlementHash, anchorStatus, type,
  });
  return { settlementHash, anchorTxId: wd.id, anchorStatus };
}
