/**
 * Milestone-to-anchor evidence run (SOW Deliverable 2, Section 6):
 *
 *   compliance clears worker -> enterprise funds a milestone escrow ->
 *   enterprise approves -> worker claims on-chain (contract releases funds) ->
 *   claimed funds settle through the Stellar anchor (SEP-10 -> SEP-12 ->
 *   SEP-6 withdraw -> ON-CHAIN SETTLEMENT PAYMENT) -> anchor status.
 *
 * Every step runs the same code paths the API uses (lib/escrow.ts and
 * rails/anchor.ts). Prints each tx hash with a stellar.expert link.
 *
 * Run: node --env-file=../../.env.local --import tsx scripts/escrow-anchor-e2e.ts
 * Requires ESCROW_CONTRACT_ADDRESS, ESCROW_COMPLIANCE_SECRET, ANCHOR_HOME_DOMAIN.
 */
import { Keypair } from '@stellar/stellar-sdk';
import axios from 'axios';
import {
  approveMilestone,
  attestationHash,
  claimMilestone,
  complianceAuthorityPublic,
  createEscrow,
  setClearance,
} from '../src/lib/escrow.js';
import { AnchorActionRequiredError, anchorHomeDomain, type AnchorProtocol } from '../src/lib/anchor.js';
import { sendAnchorPayout } from '../src/rails/anchor.js';

const explorer = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
const MILESTONE_XLM = '10';

/** Stands in for the worker's saved payout details (users.payout_details). */
const WORKER_DETAILS = {
  first_name: 'Lionel', last_name: 'Rich', email_address: 'createdbylionel@gmail.com',
  bank_number: '23123', bank_account_number: '1234567890',
};

async function fund(pub: string) {
  await axios.get(`https://friendbot.stellar.org?addr=${encodeURIComponent(pub)}`, { timeout: 30000 });
}

/**
 * The reference anchor parks a withdrawal at `incomplete` until the user
 * finishes a step on the anchor's own website. That is a normal anchor flow,
 * not an error: print the URL, wait for the human to complete it, then resume
 * the SAME anchor transaction (a settlement already sent is never repeated).
 */
async function cashOutWithAnchor(workerSecret: string) {
  let anchorTxId: string | undefined;
  let protocol: AnchorProtocol | undefined;
  let settlementHash: string | undefined;
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    try {
      return await sendAnchorPayout({
        payerSecret: workerSecret,
        amountXlm: MILESTONE_XLM,
        kyc: WORKER_DETAILS,
        resume: anchorTxId ? { anchorTxId, protocol, settlementHash } : undefined,
        onWithdrawCreated: async (id, p) => { anchorTxId = id; protocol = p; },
        onSettled: async (hash) => { settlementHash = hash; },
      });
    } catch (err) {
      if (!(err instanceof AnchorActionRequiredError) || Date.now() > deadline) throw err;
      anchorTxId = err.anchorTxId;
      console.log('   ⏸ The anchor needs a step completed on its website. Open this in a browser');
      console.log('     and submit the form (waiting up to 15 min, then resuming automatically):');
      console.log(`     ${err.moreInfoUrl}`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

async function main() {
  const enterprise = Keypair.random();
  const worker = Keypair.random();
  console.log(`anchor:     ${anchorHomeDomain()}`);
  console.log(`enterprise: ${enterprise.publicKey()}`);
  console.log(`worker:     ${worker.publicKey()}`);
  console.log(`compliance: ${complianceAuthorityPublic()}`);

  console.log('\nFunding accounts via Friendbot…');
  await fund(enterprise.publicKey());
  await fund(worker.publicKey());

  console.log('\n1) compliance clears the worker (KYC verified, sanctions clear)…');
  const clearHash = await setClearance(
    worker.publicKey(),
    Math.floor(Date.now() / 1000) + 3600,
    attestationHash({ worker: worker.publicKey(), status: 'verified', sanctions_status: 'clear' }),
  );
  console.log(`   tx: ${clearHash}\n   ${explorer(clearHash)}`);

  console.log(`\n2) create — enterprise locks ${MILESTONE_XLM} XLM for one milestone…`);
  const { escrowId, hash: createHash } = await createEscrow(
    enterprise.secret(), worker.publicKey(), [MILESTONE_XLM], Math.floor(Date.now() / 1000) + 3600,
  );
  console.log(`   escrow id: ${escrowId}\n   tx: ${createHash}\n   ${explorer(createHash)}`);

  console.log('\n3) approve milestone 0 (enterprise checkpoint)…');
  const approveHash = await approveMilestone(enterprise.secret(), escrowId, 0);
  console.log(`   tx: ${approveHash}\n   ${explorer(approveHash)}`);

  console.log('\n4) claim — contract releases the tranche to the worker…');
  const claimHash = await claimMilestone(worker.secret(), escrowId, 0);
  console.log(`   tx: ${claimHash}\n   ${explorer(claimHash)}`);

  console.log('\n5) anchor cash-out — SEP-10 → SEP-12 → SEP-6 → on-chain settlement…');
  const payout = await cashOutWithAnchor(worker.secret());
  console.log(`   anchor tx id:      ${payout.anchorTxId}`);
  console.log(`   anchor status:     ${payout.anchorStatus}`);
  console.log(`   settlement tx:     ${payout.settlementHash}\n   ${explorer(payout.settlementHash)}`);

  console.log('\n── Evidence hashes (SOW Section 6, Deliverable 2) ────────');
  console.log(`   clearance  : ${clearHash}`);
  console.log(`   create     : ${createHash}`);
  console.log(`   approve    : ${approveHash}`);
  console.log(`   claim      : ${claimHash}`);
  console.log(`   settlement : ${payout.settlementHash}  (anchor tx ${payout.anchorTxId}, ${payout.anchorStatus})`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err?.response?.data ?? err);
    process.exit(1);
  },
);
