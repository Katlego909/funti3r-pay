/**
 * Mainnet dry run (SOW #3, Deliverable 2): builds and signs, against the live Stellar mainnet, exactly the transactions
 * production would send for a new worker, and checks them, WITHOUT SUBMITTING anything. No money moves, and no mainnet
 * XLM is needed: an unfunded sponsor is reported with what it must hold.
 *
 *   1. reads mainnet's current fees and confirms Circle's USDC is the asset the platform would trust;
 *   2. reports what a mainnet sponsor must hold, and what MAINNET_SPONSOR_PUBLIC_KEY (if set) can afford today;
 *   3. builds the sponsored-account transaction (account + USDC trustline, every reserve sponsored) and checks it;
 *   4. builds a worker's USDC payment fee-bumped by the sponsor, and checks it.
 *
 * Uses the same builders as production (buildSponsoredAccountTx, buildFeeBump in src/lib/stellar.ts).
 * Run: node --env-file=../../.env.local --import tsx scripts/mainnet-dry-run.ts
 */
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { buildFeeBump, buildSponsoredAccountTx, sponsoredReserveXlm } from '../src/lib/stellar.js';

const HORIZON = 'https://horizon.stellar.org';
const PASSPHRASE = Networks.PUBLIC;
/** Circle's USDC on Stellar mainnet. */
const USDC = { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' };

async function get(path: string): Promise<any> {
  const res = await fetch(`${HORIZON}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}
function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`Check failed: ${what}`);
  console.log(`  ok: ${what}`);
}

async function main() {
  console.log('Stellar MAINNET dry run: nothing below is submitted.\n');

  console.log('1. Network and asset');
  const root = await get('/');
  check(root.network_passphrase === PASSPHRASE, `connected to mainnet (ledger ${root.history_latest_ledger})`);
  const fees = await get('/fee_stats');
  const fee = String(Math.max(Number(fees.last_ledger_base_fee) * 10, 100)); // production's bid: networkFee()
  console.log(`  base fee ${fees.last_ledger_base_fee} stroops; production bids ${fee} per operation`);
  const asset = (await get(`/assets?asset_code=${USDC.code}&asset_issuer=${USDC.issuer}`))?._embedded?.records?.[0];
  check(!!asset, `Circle USDC exists on mainnet (${asset?.accounts?.authorized ?? '?'} accounts hold it)`);

  console.log('\n2. Sponsor');
  // The transactions are built and signed with a throwaway key standing in for the sponsor, so no mainnet secret is ever
  // loaded here; production signs the same transactions with the real sponsor key.
  const sponsor = Keypair.random();
  const perWorker = sponsoredReserveXlm(1); // account + USDC trustline
  console.log(`  a mainnet sponsor needs 1 XLM for its own minimum balance, plus ${perWorker} XLM per worker account, plus fees`);
  const realSponsor = process.env.MAINNET_SPONSOR_PUBLIC_KEY;
  if (realSponsor) {
    const funded = await get(`/accounts/${realSponsor}`);
    const xlm = funded ? Number(funded.balances.find((b: any) => b.asset_type === 'native').balance) : 0;
    console.log(funded
      ? `  ${realSponsor} holds ${xlm} XLM: enough for about ${Math.max(0, Math.floor((xlm - 1) / Number(perWorker)))} worker accounts`
      : `  ${realSponsor} is not funded on mainnet yet`);
  } else {
    console.log('  no mainnet sponsor funded yet (set MAINNET_SPONSOR_PUBLIC_KEY once there is one, to see what it can afford)');
  }

  console.log('\n3. Sponsored account for a new worker (account + USDC trustline)');
  const worker = Keypair.random();
  const tx = buildSponsoredAccountTx({
    sponsorAccount: new Account(sponsor.publicKey(), '0'), sponsor, account: worker, trustlines: [USDC],
    fee, networkPassphrase: PASSPHRASE,
  });
  const decoded = TransactionBuilder.fromXDR(tx.toXDR(), PASSPHRASE) as typeof tx;
  check(decoded.hash().equals(tx.hash()), 'the signed transaction round-trips through XDR on the mainnet passphrase');
  check(decoded.operations.map((o) => o.type).join(',') === 'beginSponsoringFutureReserves,createAccount,changeTrust,endSponsoringFutureReserves',
    'operations: begin sponsoring, create account (0 XLM), USDC trustline, end sponsoring');
  check(sponsor.verify(tx.hash(), tx.signatures[0].signature()) && worker.verify(tx.hash(), tx.signatures[1].signature()),
    'signed by the sponsor and the new account, as the network requires');
  console.log(`  worker pays 0 XLM; sponsor locks ${perWorker} XLM; fee bid ${Number(tx.fee) / 1e7} XLM`);
  console.log(`  tx hash (not submitted) ${tx.hash().toString('hex')}`);

  console.log('\n4. The worker (0 XLM) pays 10 USDC; the sponsor pays the fee');
  const inner = new TransactionBuilder(new Account(worker.publicKey(), '0'), { fee, networkPassphrase: PASSPHRASE })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: new Asset(USDC.code, USDC.issuer), amount: '10' }))
    .setTimeout(60)
    .build();
  inner.sign(worker);
  const bump = buildFeeBump(inner, sponsor, PASSPHRASE);
  check(bump.feeSource === sponsor.publicKey() && sponsor.verify(bump.hash(), bump.signatures[0].signature()), 'the fee bump is paid and signed by the sponsor');
  check(bump.innerTransaction.hash().equals(inner.hash()), 'the worker\'s own signed payment is inside it, unchanged');
  console.log(`  fee bump bid ${Number(bump.fee) / 1e7} XLM; hash (not submitted) ${bump.hash().toString('hex')}`);

  console.log('\nDry run complete: every transaction built and signed for mainnet, none submitted.');
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
