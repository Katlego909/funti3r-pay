/**
 * End-to-end escrow + compliance-gate evidence run on testnet (SOW Section 6):
 *   fresh enterprise+worker → create BLOCKED (uncleared) → compliance clears
 *   worker → create (fund) → approve → compliance REVOKES (simulated sanctions
 *   hit) → claim BLOCKED → freeze BLOCKED → re-clear → claim pays out → wait
 *   past expiry → refund → verify balances.
 *
 * Prints every transaction hash with stellar.expert links.
 *
 * Run: node --env-file=../../.env.local --import tsx scripts/escrow-e2e.ts
 * Requires ESCROW_CONTRACT_ADDRESS and ESCROW_COMPLIANCE_SECRET.
 */
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import axios from 'axios';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approveMilestone,
  claimMilestone,
  attestationHash,
  complianceAuthorityPublic,
  createEscrow,
  EscrowContractError,
  getEscrow,
  refundEscrow,
  returnFrozen,
  revokeClearance,
  setClearance,
  setFrozen,
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

/** Runs `fn` and asserts the contract's gate rejected it with `expectedCode`. */
async function expectBlocked(label: string, expectedCode: number, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof EscrowContractError && err.code === expectedCode) {
      console.log(`   ✔ ${label} rejected by the contract: #${err.code} "${err.message}"`);
      return;
    }
    throw err;
  }
  throw new Error(`${label} should have been blocked (#${expectedCode}) but succeeded`);
}

async function main() {
  const enterprise = Keypair.random();
  const worker = Keypair.random();
  console.log(`enterprise: ${enterprise.publicKey()}`);
  console.log(`worker:     ${worker.publicKey()}`);
  console.log(`compliance: ${complianceAuthorityPublic()}`);

  console.log('\nFunding accounts via Friendbot…');
  await fund(enterprise.publicKey());
  await fund(worker.publicKey());
  await fund(complianceAuthorityPublic()).catch(() => undefined); // already funded is fine

  const screening = {
    worker: worker.publicKey(),
    status: 'verified',
    sanctions_status: 'clear',
    checked_at: new Date().toISOString(),
  };
  const expiry = Math.floor(Date.now() / 1000) + 150;
  const clearUntil = Math.floor(Date.now() / 1000) + 3600;

  console.log('\n1) GATE: create for an UNCLEARED worker…');
  await expectBlocked('create', 11, () =>
    createEscrow(enterprise.secret(), worker.publicKey(), [25, 40], expiry),
  );

  console.log('\n2) compliance clears the worker (screening hash recorded on-chain)…');
  const clearHash = await setClearance(worker.publicKey(), clearUntil, attestationHash(screening));
  console.log(`   tx: ${clearHash}
   ${explorer(clearHash)}`);

  console.log('\n3) create — enterprise funds 65 XLM into escrow…');
  const { escrowId, hash: createHash } = await createEscrow(
    enterprise.secret(), worker.publicKey(), [25, 40], expiry,
  );
  console.log(`   escrow id: ${escrowId}
   tx: ${createHash}
   ${explorer(createHash)}`);

  console.log('\n4) approve milestone 0 (enterprise)…');
  const approveHash = await approveMilestone(enterprise.secret(), escrowId, 0);
  console.log(`   tx: ${approveHash}
   ${explorer(approveHash)}`);

  console.log('\n5) compliance REVOKES the worker (simulated new sanctions hit)…');
  const revokeHash = await revokeClearance(worker.publicKey());
  console.log(`   tx: ${revokeHash}
   ${explorer(revokeHash)}`);
  console.log('   GATE: worker tries to claim the approved milestone…');
  await expectBlocked('claim', 11, () => claimMilestone(worker.secret(), escrowId, 0));
  console.log(`   worker balance still: ${await xlmBalance(worker.publicKey())} XLM`);

  console.log('\n6) compliance re-clears the worker, then FREEZES the escrow…');
  const reclearHash = await setClearance(worker.publicKey(), clearUntil, attestationHash({ ...screening, rescreened: true }));
  console.log(`   re-clear tx: ${reclearHash}`);
  const freezeHash = await setFrozen(escrowId, true);
  console.log(`   freeze tx:   ${freezeHash}
   ${explorer(freezeHash)}`);
  await expectBlocked('claim (frozen)', 12, () => claimMilestone(worker.secret(), escrowId, 0));
  const unfreezeHash = await setFrozen(escrowId, false);
  console.log(`   unfreeze tx: ${unfreezeHash}`);

  console.log('\n7) claim milestone 0 (worker receives 25 XLM)…');
  const balanceBefore = Number(await xlmBalance(worker.publicKey()));
  const claimHash = await claimMilestone(worker.secret(), escrowId, 0);
  console.log(`   tx: ${claimHash}
   ${explorer(claimHash)}`);
  const balanceAfter = Number(await xlmBalance(worker.publicKey()));
  console.log(`   worker balance: ${balanceAfter} XLM (+${(balanceAfter - balanceBefore).toFixed(2)})`);

  const waitMs = expiry * 1000 - Date.now() + 10_000;
  if (waitMs > 0) {
    console.log(`
8) waiting ${Math.ceil(waitMs / 1000)}s for expiry…`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  console.log('   refund (enterprise reclaims the unapproved 40 XLM)…');
  const { refundedStroops, hash: refundHash } = await refundEscrow(enterprise.secret(), escrowId);
  console.log(`   refunded: ${Number(refundedStroops) / 1e7} XLM
   tx: ${refundHash}
   ${explorer(refundHash)}`);

  console.log(`
9) compliance hold upheld: freeze a second escrow, then return its funds to the enterprise…`);
  const second = await createEscrow(enterprise.secret(), worker.publicKey(), [15, 15], Math.floor(Date.now() / 1000) + 3600);
  const secondApproveHash = await approveMilestone(enterprise.secret(), second.escrowId, 0);
  const secondFreezeHash = await setFrozen(second.escrowId, true);
  const { returnedStroops, hash: returnHash } = await returnFrozen(second.escrowId);
  console.log(`   returned: ${Number(returnedStroops) / 1e7} XLM
   tx: ${returnHash}
   ${explorer(returnHash)}`);

  const finalState = await getEscrow(escrowId, enterprise.publicKey());
  console.log('\n── Final state ───────────────────────────────────────────');
  console.log(`   escrow status:  ${finalState.status}`);
  console.log(`   milestones:     ${finalState.milestones.join(', ')}`);
  console.log(`   enterprise:     ${await xlmBalance(enterprise.publicKey())} XLM`);
  console.log(`   worker:         ${await xlmBalance(worker.publicKey())} XLM`);

  console.log('\n── Evidence hashes (SOW Section 6) ───────────────────────');
  console.log(`   clearance : ${clearHash}`);
  console.log(`   create    : ${createHash}`);
  console.log(`   approve   : ${approveHash}`);
  console.log(`   revoke    : ${revokeHash}`);
  console.log(`   freeze    : ${freezeHash}`);
  console.log(`   claim     : ${claimHash}`);
  console.log(`   refund    : ${refundHash}`);
  console.log(`   return    : ${returnHash}`);

  const proofPath = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/enterprise-dashboard/src/data/proof.json');
  mkdirSync(dirname(proofPath), { recursive: true });
  writeFileSync(proofPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    network: 'testnet',
    contract: process.env.ESCROW_CONTRACT_ADDRESS,
    enterprise: enterprise.publicKey(),
    worker: worker.publicKey(),
    compliance: complianceAuthorityPublic(),
    steps: [
      { label: 'Compliance clears the worker (screening hash on-chain)', hash: clearHash },
      { label: 'Enterprise funds the escrow', hash: createHash },
      { label: 'Enterprise approves milestone 1', hash: approveHash },
      { label: 'Compliance revokes the worker (simulated sanctions hit)', hash: revokeHash },
      { label: 'Compliance re-clears the worker', hash: reclearHash },
      { label: 'Compliance freezes the escrow', hash: freezeHash },
      { label: 'Compliance lifts the freeze', hash: unfreezeHash },
      { label: 'Worker claims milestone 1', hash: claimHash },
      { label: 'Enterprise refunds the unapproved tranche after expiry', hash: refundHash },
      { label: 'Second escrow: enterprise approves milestone 1', hash: secondApproveHash },
      { label: 'Second escrow: compliance freezes it', hash: secondFreezeHash },
      { label: 'Second escrow: compliance returns unclaimed funds to the enterprise', hash: returnHash },
    ],
    blocked: [
      'Create for an uncleared worker rejected by the contract (#11 NotCleared)',
      'Claim after clearance revoked rejected (#11 NotCleared)',
      'Claim while the escrow is frozen rejected (#12 EscrowFrozen)',
    ],
  }, null, 2));
  console.log(`   proof data written to ${proofPath}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err?.response?.data ?? err);
    process.exit(1);
  },
);
