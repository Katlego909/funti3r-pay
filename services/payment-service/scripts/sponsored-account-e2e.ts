/**
 * Testnet proof that workers need no XLM of their own (SOW #3, Deliverable 2):
 *   1. a brand-new worker account is created by the platform sponsor, with a USDC trustline, every reserve sponsored;
 *   2. the worker is paid 1 USDC;
 *   3. the worker, still holding 0 XLM, sends 0.5 USDC: the sponsor pays the fee (a fee bump).
 *   4. the worker, still holding 0 XLM, claims a USDC escrow milestone: the sponsor pays the contract call's fee.
 * Each step is checked on Horizon and its transaction hash printed.
 *
 * Prereqs (.env.local): STELLAR_SPONSOR_SECRET (funded), STELLAR_OPERATOR_SECRET (funded, pays the worker),
 * STELLAR_USDC_ISSUER, ESCROW_CONTRACT_ADDRESS and ESCROW_COMPLIANCE_SECRET (the escrow), DATABASE_URL (the per-account lock).
 * Run: node --env-file=../../.env.local --import tsx scripts/sponsored-account-e2e.ts
 */
import { Keypair } from '@stellar/stellar-sdk';
import { closePostgres } from '@funti3r/database';
import { stellarNetwork } from '@funti3r/shared-utils';
import { activateAccount, ensureAssetBalance, ensureTrustline, payExactWithXlm, sendPayment, sponsorPublicKey } from '../src/lib/stellar.js';
import { approveMilestone, attestationHash, claimMilestone, createEscrow, escrowToken, setClearance } from '../src/lib/escrow.js';
import { getCurrency } from '../src/lib/currencies.js';

const { horizonUrl, explorerUrl, isMainnet } = stellarNetwork();

async function account(id: string): Promise<any> {
  return (await fetch(`${horizonUrl}/accounts/${id}`)).json();
}
async function transaction(hash: string): Promise<any> {
  return (await fetch(`${horizonUrl}/transactions/${hash}`)).json();
}
const nativeBalance = (a: any) => a.balances.find((b: any) => b.asset_type === 'native').balance;
function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`Check failed: ${what}`);
  console.log(`  ok: ${what}`);
}

async function main() {
  if (isMainnet) throw new Error('This script moves testnet money only');
  const operatorSecret = process.env.STELLAR_OPERATOR_SECRET;
  const usdc = getCurrency('USDC');
  const sponsor = sponsorPublicKey();
  if (!operatorSecret || !usdc?.issuer || !sponsor) throw new Error('STELLAR_OPERATOR_SECRET, STELLAR_USDC_ISSUER and STELLAR_SPONSOR_SECRET are required');
  const operator = Keypair.fromSecret(operatorSecret).publicKey();
  const worker = Keypair.random();
  const usdcLine = (a: any) => a.balances.find((b: any) => b.asset_code === usdc.code && b.asset_issuer === usdc.issuer);
  console.log(`worker  ${worker.publicKey()}\nsponsor ${sponsor}`);

  console.log('\n1. Create the worker account, sponsored, with a USDC trustline');
  const created = await activateAccount(worker.secret(), [{ code: usdc.code, issuer: usdc.issuer }]);
  check(created.created === true && !!created.hash, 'the account was created');
  const w1 = await account(worker.publicKey());
  check(Number(nativeBalance(w1)) === 0, 'the worker holds 0 XLM');
  check(w1.num_sponsored === 3, 'all 3 reserves (account x2, trustline x1) are sponsored');
  check(!!usdcLine(w1), 'the USDC trustline exists');
  console.log(`  tx ${created.hash}`);

  console.log('\n2. Pay the worker 1 USDC');
  const paid = await payExactWithXlm(operatorSecret, worker.publicKey(), usdc.code, usdc.issuer, '1');
  check(Number(usdcLine(await account(worker.publicKey())).balance) === 1, 'the worker holds 1 USDC');
  console.log(`  tx ${paid.hash}`);

  console.log('\n3. The worker, with 0 XLM, sends 0.5 USDC: the sponsor pays the fee');
  await ensureTrustline(operatorSecret, usdc.code, usdc.issuer); // the receiving account must be able to hold USDC
  const sent = await sendPayment(worker.secret(), operator, '0.5', usdc.code, usdc.issuer);
  const t = await transaction(sent);
  check(t.fee_account === sponsor, 'the fee was paid by the sponsor (fee bump)');
  check(t.source_account === worker.publicKey(), 'the payment is the worker\'s own transaction');
  check(Number(nativeBalance(await account(worker.publicKey()))) === 0, 'the worker still holds 0 XLM');
  console.log(`  tx ${sent}`);

  console.log('\n4. The worker, with 0 XLM, claims a USDC escrow milestone: the sponsor pays the contract call\'s fee');
  const token = escrowToken();
  await setClearance(worker.publicKey(), Math.floor(Date.now() / 1000) + 86_400, attestationHash({ e2e: 'sponsored-account' }));
  await ensureAssetBalance(operatorSecret, token.code, token.issuer, '1');
  const { escrowId } = await createEscrow(operatorSecret, worker.publicKey(), token.address, ['1'], Math.floor(Date.now() / 1000) + 86_400);
  await approveMilestone(operatorSecret, escrowId, 0);
  const before = Number(usdcLine(await account(worker.publicKey())).balance);
  const claimHash = await claimMilestone(worker.secret(), escrowId, 0);
  const claim = await transaction(claimHash);
  check(claim.fee_account === sponsor, 'the claim\'s fee was paid by the sponsor (fee bump)');
  check(Number(usdcLine(await account(worker.publicKey())).balance) === before + 1, 'the worker received the 1 USDC milestone');
  check(Number(nativeBalance(await account(worker.publicKey()))) === 0, 'the worker still holds 0 XLM');
  console.log(`  escrow #${escrowId}, claim tx ${claimHash}`);

  console.log(`\n${explorerUrl}/account/${worker.publicKey()}`);
}

main().then(
  async () => { await closePostgres(); process.exit(0); },
  async (err) => { console.error(err); await closePostgres().catch(() => {}); process.exit(1); },
);
