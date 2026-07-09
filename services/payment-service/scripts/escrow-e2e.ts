/**
 * End-to-end escrow evidence run on testnet (SOW Section 6):
 *   fresh enterprise+worker accounts → create (fund) → approve+claim
 *   milestone 0 → wait past expiry → refund milestone 1 → verify balances.
 *
 * Prints every transaction hash with stellar.expert links.
 *
 * Run: node --env-file=../../.env.local --import tsx scripts/escrow-e2e.ts
 * Requires ESCROW_CONTRACT_ADDRESS in the environment.
 */
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import axios from 'axios';
import {
  approveMilestone,
  claimMilestone,
  createEscrow,
  getEscrow,
  refundEscrow,
} from '../src/lib/escrow.js';

const horizon = new Horizon.Server(
  process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
);

const explorer = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

async function fund(pub: string) {
  await axios.get(`https://friendbot.stellar.org?addr=${encodeURIComponent(pub)}`, {
    timeout: 30000,
  });
}

async function xlmBalance(pub: string): Promise<string> {
  const account = await horizon.loadAccount(pub);
  const native = account.balances.find((b) => b.asset_type === 'native');
  return native?.balance ?? '0';
}

async function main() {
  const enterprise = Keypair.random();
  const worker = Keypair.random();
  console.log(`enterprise: ${enterprise.publicKey()}`);
  console.log(`worker:     ${worker.publicKey()}`);

  console.log('\nFunding both via Friendbot…');
  await fund(enterprise.publicKey());
  await fund(worker.publicKey());

  // Two milestones: 25 XLM (will be approved + claimed) and 40 XLM (will be
  // refunded after expiry). Short expiry so the refund leg runs in-band.
  const expiry = Math.floor(Date.now() / 1000) + 90;
  console.log('\n1) create — enterprise funds 65 XLM into escrow…');
  const { escrowId, hash: createHash } = await createEscrow(
    enterprise.secret(),
    worker.publicKey(),
    [25, 40],
    expiry,
  );
  console.log(`   escrow id: ${escrowId}`);
  console.log(`   tx: ${createHash}`);
  console.log(`   ${explorer(createHash)}`);

  console.log('\n2) approve milestone 0 (enterprise)…');
  const approveHash = await approveMilestone(enterprise.secret(), escrowId, 0);
  console.log(`   tx: ${approveHash}`);
  console.log(`   ${explorer(approveHash)}`);

  console.log('\n3) claim milestone 0 (worker receives 25 XLM)…');
  const claimHash = await claimMilestone(worker.secret(), escrowId, 0);
  console.log(`   tx: ${claimHash}`);
  console.log(`   ${explorer(claimHash)}`);
  console.log(`   worker balance: ${await xlmBalance(worker.publicKey())} XLM`);

  const waitMs = expiry * 1000 - Date.now() + 10_000;
  if (waitMs > 0) {
    console.log(`\n4) waiting ${Math.ceil(waitMs / 1000)}s for expiry…`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  console.log('   refund (enterprise reclaims the unapproved 40 XLM)…');
  const { refundedStroops, hash: refundHash } = await refundEscrow(enterprise.secret(), escrowId);
  console.log(`   refunded: ${Number(refundedStroops) / 1e7} XLM`);
  console.log(`   tx: ${refundHash}`);
  console.log(`   ${explorer(refundHash)}`);

  const finalState = await getEscrow(escrowId, enterprise.publicKey());
  console.log('\n── Final state ───────────────────────────────────────────');
  console.log(`   escrow status:  ${finalState.status}`);
  console.log(`   milestones:     ${finalState.milestones.join(', ')}`);
  console.log(`   enterprise:     ${await xlmBalance(enterprise.publicKey())} XLM`);
  console.log(`   worker:         ${await xlmBalance(worker.publicKey())} XLM`);

  console.log('\n── Evidence hashes (SOW Section 6) ───────────────────────');
  console.log(`   create : ${createHash}`);
  console.log(`   approve: ${approveHash}`);
  console.log(`   claim  : ${claimHash}`);
  console.log(`   refund : ${refundHash}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err?.response?.data ?? err);
    process.exit(1);
  },
);
