/**
 * One-time testnet setup: makes "employer pays USD → worker receives local
 * African currency" actually settle on-chain via real Stellar path payments.
 *
 * It self-hosts what a real anchor provides:
 *   1. An ISSUER account that issues NGN/KES/GHS/ZAR/UGX.
 *   2. A DISTRIBUTOR (market-maker) account that holds inventory and places
 *      DEX offers "sell <local> for XLM" priced at LIVE FX rates, so a path
 *      payment XLM → <local> can route through real on-chain liquidity.
 *
 * On mainnet you'd drop the issuer/distributor and point the registry at real
 * anchors (e.g. Cowrie for NGN). The payment code does not change.
 *
 * Keys: reuses STELLAR_AFRICA_ISSUER_SECRET / STELLAR_AFRICA_DISTRIBUTOR_SECRET
 * from the env if present; otherwise generates new ones and prints them so they
 * can be saved to .env.local (re-running then refreshes offers at current FX).
 *
 * Run from services/payment-service:
 *   node --env-file=../../.env.local --import tsx scripts/setup-africa-liquidity.ts
 */
import {
  Keypair, Asset, Operation, TransactionBuilder, Networks, Horizon, BASE_FEE,
} from '@stellar/stellar-sdk';
import axios from 'axios';

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === 'MAINNET' ? Networks.PUBLIC : Networks.TESTNET;
const horizon = new Horizon.Server(HORIZON_URL);

const CURRENCIES = ['NGN', 'KES', 'GHS', 'ZAR', 'UGX'] as const;
const ISSUE_AMOUNT = '100000000';   // 100M units of each local currency to the distributor
const OFFER_AMOUNT = '90000000';    // amount of each currency offered for sale

async function friendbot(pub: string) {
  try {
    await axios.get(`https://friendbot.stellar.org/?addr=${pub}`, { timeout: 15000 });
  } catch { /* may already be funded */ }
}

async function loadOrFund(secret: string): Promise<Horizon.AccountResponse> {
  const kp = Keypair.fromSecret(secret);
  try {
    return await horizon.loadAccount(kp.publicKey());
  } catch {
    await friendbot(kp.publicKey());
    return horizon.loadAccount(kp.publicKey());
  }
}

async function submit(builderFn: (b: TransactionBuilder) => void, signer: Keypair) {
  const account = await horizon.loadAccount(signer.publicKey());
  const fee = await horizon.fetchBaseFee().catch(() => Number(BASE_FEE));
  const builder = new TransactionBuilder(account, {
    fee: String(Math.max(fee * 10, 1000)),
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  builderFn(builder);
  const tx = builder.setTimeout(60).build();
  tx.sign(signer);
  return horizon.submitTransaction(tx);
}

async function main() {
  // 1. Keys (reuse from env or generate).
  const issuerKp = process.env.STELLAR_AFRICA_ISSUER_SECRET
    ? Keypair.fromSecret(process.env.STELLAR_AFRICA_ISSUER_SECRET)
    : Keypair.random();
  const distKp = process.env.STELLAR_AFRICA_DISTRIBUTOR_SECRET
    ? Keypair.fromSecret(process.env.STELLAR_AFRICA_DISTRIBUTOR_SECRET)
    : Keypair.random();

  const generated = !process.env.STELLAR_AFRICA_ISSUER_SECRET;
  if (generated) {
    console.log('\n=== Generated keypairs — ADD THESE TO .env.local ===');
    console.log(`STELLAR_AFRICA_ISSUER=${issuerKp.publicKey()}`);
    console.log(`STELLAR_AFRICA_ISSUER_SECRET=${issuerKp.secret()}`);
    console.log(`STELLAR_AFRICA_DISTRIBUTOR_SECRET=${distKp.secret()}`);
    console.log('====================================================\n');
  }

  console.log('Issuer:      ', issuerKp.publicKey());
  console.log('Distributor: ', distKp.publicKey());

  // 2. Fund both accounts.
  await loadOrFund(issuerKp.secret());
  await loadOrFund(distKp.secret());
  console.log('Accounts funded.');

  // 3. Live FX (USD→local) and XLM/USD price.
  const fx = (await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 10000 })).data.rates;
  const xlmUsd = Number(
    (await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: 'stellar', vs_currencies: 'usd' }, timeout: 10000,
    })).data.stellar.usd,
  );
  console.log('XLM price: $' + xlmUsd);

  // 4. Distributor trustlines to each currency.
  for (const code of CURRENCIES) {
    const asset = new Asset(code, issuerKp.publicKey());
    const has = (await horizon.loadAccount(distKp.publicKey())).balances.some(
      (b: any) => b.asset_code === code && b.asset_issuer === issuerKp.publicKey(),
    );
    if (!has) {
      await submit((b) => b.addOperation(Operation.changeTrust({ asset, limit: '1000000000' })), distKp);
      console.log(`  trustline added: ${code}`);
    }
  }

  // 5. Issuer issues inventory to the distributor.
  for (const code of CURRENCIES) {
    const asset = new Asset(code, issuerKp.publicKey());
    await submit((b) => b.addOperation(Operation.payment({
      destination: distKp.publicKey(), asset, amount: ISSUE_AMOUNT,
    })), issuerKp);
    console.log(`  issued ${ISSUE_AMOUNT} ${code} to distributor`);
  }

  // 6. Distributor places "sell <local> for XLM" offers at live FX.
  //    Price = XLM per 1 local unit = (1/localPerUsd) / xlmUsd.
  for (const code of CURRENCIES) {
    const localPerUsd = Number(fx[code]);
    const xlmPerLocal = (1 / localPerUsd) / xlmUsd;
    const price = xlmPerLocal.toFixed(7);
    const asset = new Asset(code, issuerKp.publicKey());
    await submit((b) => b.addOperation(Operation.manageSellOffer({
      selling: asset,
      buying: Asset.native(),
      amount: OFFER_AMOUNT,
      price,            // XLM per local
      offerId: '0',     // create (or replace via passive? keep simple)
    })), distKp);
    console.log(`  offer: sell ${code} @ ${price} XLM  (1 USD = ${localPerUsd} ${code})`);
  }

  // 7. Verify a path now exists XLM → each currency.
  console.log('\nPath check (XLM → local):');
  for (const code of CURRENCIES) {
    const asset = new Asset(code, issuerKp.publicKey());
    const paths = await horizon
      .strictReceivePaths([Asset.native()], asset, '100')
      .call()
      .catch(() => ({ records: [] as any[] }));
    console.log(`  ${code}: ${(paths.records?.length ?? 0) > 0 ? 'PATH OK' : 'NO PATH'}`);
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Setup failed:', err?.response?.data?.extras?.result_codes ?? err);
  process.exit(1);
});
