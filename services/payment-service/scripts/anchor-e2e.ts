/**
 * Anchor disbursement evidence run (SOW Deliverable 2, Section 6):
 * full SEP-31 direct-payment flow against ANCHOR_HOME_DOMAIN
 * (testnet: testanchor.stellar.org — SDF reference anchor, no credentials):
 *
 *   SEP-10 auth → SEP-12 receiver KYC → SEP-31 transaction →
 *   ON-CHAIN SETTLEMENT PAYMENT (the evidence hash) → anchor status poll.
 *
 * Run: node --env-file=../../.env.local --import tsx scripts/anchor-e2e.ts
 */
import axios from 'axios';
import { Keypair } from '@stellar/stellar-sdk';
import {
  sep10Auth,
  sep12PutCustomer,
  sep31Info,
  sep31CreateTransaction,
  sep31GetTransaction,
  sep6WithdrawInfo,
  sep6Withdraw,
  sep6GetTransaction,
  sep6AwaitSettlementDetails,
  anchorMemo,
  anchorHomeDomain,
} from '../src/lib/anchor.js';
import { sendPayment, ensureTrustline, payExactWithXlm } from '../src/lib/stellar.js';

const explorer = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
const AMOUNT = '5';

async function fund(pub: string) {
  await axios.get(`https://friendbot.stellar.org?addr=${encodeURIComponent(pub)}`, { timeout: 30000 });
}

/** Fill the anchor's required transaction fields with demo values. */
function demoFieldValues(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries<any>(fields)) {
    if (spec?.optional) continue;
    if (Array.isArray(spec?.choices) && spec.choices.length > 0) out[name] = String(spec.choices[0]);
    else if (/email/.test(name)) out[name] = 'worker@funti3r.xyz';
    else out[name] = '123456789';
  }
  return out;
}

async function main() {
  console.log(`Anchor: ${anchorHomeDomain()}`);

  const sender = Keypair.random();
  console.log(`sender: ${sender.publicKey()}`);
  console.log('Funding via Friendbot…');
  await fund(sender.publicKey());

  console.log('\n1) SEP-10 web authentication…');
  const jwt = await sep10Auth(sender.secret());
  console.log(`   JWT obtained (${jwt.slice(0, 24)}…)`);

  console.log('\n2) SEP-12 customer registration…');
  const customerId = await sep12PutCustomer(
    jwt,
    { first_name: 'Funti3r', last_name: 'Worker', email_address: 'worker@funti3r.xyz' },
  );
  console.log(`   customer id: ${customerId}`);

  // Probe SEP-31 first (production anchors), fall back to SEP-6 withdraw
  // (what the reference anchor has enabled) — same order the rail uses.
  console.log('\n3) Probing SEP-31 receive assets…');
  const sep31Assets = await sep31Info(jwt).catch(() => []);
  let protocol: 'sep31' | 'sep6';
  let anchorTxId: string;
  let settleTo: { accountId: string; memoType: string; memo: string };
  let assetCode: string;
  let assetIssuer: string | undefined;

  if (sep31Assets.length > 0) {
    protocol = 'sep31';
    const asset = sep31Assets.find((a) => !a.issuer) ?? sep31Assets[0];
    assetCode = asset.code;
    assetIssuer = asset.issuer;
    console.log(`   SEP-31 available — using ${asset.code}`);
    const tx = await sep31CreateTransaction(jwt, {
      amount: AMOUNT,
      assetCode: asset.code,
      assetIssuer: asset.issuer,
      receiverId: customerId,
      transactionFields: demoFieldValues(asset.transactionFields),
    });
    anchorTxId = tx.id;
    settleTo = { accountId: tx.stellarAccountId, memoType: tx.stellarMemoType, memo: tx.stellarMemo };
  } else {
    console.log('   SEP-31 receive list is empty — falling back to SEP-6 withdraw');
    const withdrawable = await sep6WithdrawInfo();
    for (const a of withdrawable) {
      console.log(`   - ${a.code} (${a.minAmount ?? '?'}–${a.maxAmount ?? '?'}) via ${a.types.join('/')}`);
    }
    const asset = withdrawable.find((a) => a.code === 'native') ?? withdrawable[0];
    if (!asset) throw new Error('Anchor offers neither SEP-31 nor SEP-6 withdraw assets');
    protocol = 'sep6';
    assetCode = asset.code === 'native' ? 'XLM' : asset.code;
    console.log(`   using: ${asset.code} → ${asset.types[0]}`);

    console.log('\n4) SEP-6 withdraw request…');
    const wd = await sep6Withdraw(jwt, {
      assetCode: asset.code,
      type: asset.types[0],
      amount: AMOUNT,
      dest: '123456789',
    });
    anchorTxId = wd.id;
    settleTo = wd.accountId
      ? { accountId: wd.accountId, memoType: wd.memoType, memo: wd.memo }
      : await sep6AwaitSettlementDetails(jwt, wd.id, (name, spec) => {
          const value =
            spec.choices?.[0] ??
            (/birth_date/.test(name) ? '1990-01-01'
              : /expiration/.test(name) ? '2030-01-15'
              : /_date/.test(name) ? '2020-01-15'
              : /country/.test(name) ? 'USA'
              : /email/.test(name) ? 'worker@funti3r.xyz'
              : /routing|bank_number/.test(name) ? '121122676'
              : '123456789');
          console.log(`   supplying KYC field ${name} = ${value}`);
          return value;
        });
  }

  console.log(`   anchor tx id: ${anchorTxId}`);
  console.log(`   settle to: ${settleTo.accountId} (memo ${settleTo.memoType}: ${settleTo.memo})`);

  // Acquire the settlement asset when it isn't native XLM.
  if (assetIssuer) {
    console.log(`\n   Acquiring ${AMOUNT} ${assetCode} via trustline + DEX path payment…`);
    await ensureTrustline(sender.secret(), assetCode, assetIssuer);
    await payExactWithXlm(sender.secret(), sender.publicKey(), assetCode, assetIssuer, AMOUNT, 0.1);
  }

  console.log('\n5) On-chain settlement payment (the evidence hash)…');
  const settleHash = await sendPayment(
    sender.secret(),
    settleTo.accountId,
    AMOUNT,
    assetCode,
    assetIssuer,
    anchorMemo(settleTo.memoType, settleTo.memo),
  );
  console.log(`   tx: ${settleHash}`);
  console.log(`   ${explorer(settleHash)}`);

  console.log('\n6) Polling anchor for disbursement status…');
  let status = 'pending_user_transfer_start';
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = protocol === 'sep31'
      ? await sep31GetTransaction(jwt, anchorTxId)
      : await sep6GetTransaction(jwt, anchorTxId);
    if (s.status !== status) {
      status = s.status;
      console.log(`   status: ${status}${s.requiredInfoMessage ? ` (${s.requiredInfoMessage})` : ''}`);
    }
    if (['completed', 'error', 'refunded'].includes(status)) break;
  }

  console.log('\n── Evidence (SOW Section 6, Deliverable 2) ───────────────');
  console.log(`   anchor            : ${anchorHomeDomain()} (SEP-10/12 + ${protocol === 'sep31' ? 'SEP-31' : 'SEP-6 withdraw'})`);
  console.log(`   anchor tx id      : ${anchorTxId}`);
  console.log(`   settlement asset  : ${assetCode}`);
  console.log(`   settlement tx     : ${settleHash}`);
  console.log(`   explorer          : ${explorer(settleHash)}`);
  console.log(`   final anchor state: ${status}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err?.response?.data ?? err);
    process.exit(1);
  },
);
