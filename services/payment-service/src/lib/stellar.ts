import {
  Horizon,
  Keypair,
  Asset,
  Claimant,
  FeeBumpTransaction,
  Operation,
  TransactionBuilder,
  Transaction,
  Memo,
} from '@stellar/stellar-sdk';
import { AppError, createLogger, ExternalServiceError, stellarNetwork } from '@funti3r/shared-utils';
import { getJSON, setJSON, withAdvisoryLock } from '@funti3r/database';
import { accountsTouchedBy, balanceCacheKey, forgetBalances } from './balanceCache.js';
import { fromStroops, toStroops } from './amounts.js';

const logger = createLogger('StellarService');

const { horizonUrl: HORIZON_URL, passphrase: NETWORK_PASSPHRASE } = stellarNetwork();

const horizon = new Horizon.Server(HORIZON_URL);
// Reads give up after 30s instead of hanging on a slow Horizon. Submits keep the SDK's own 60s; streams are unaffected.
horizon.httpClient.defaults.timeout = 30_000;

/**
 * A submission that got no verdict from Horizon: a timeout, a dropped connection or a 5xx (504 means "submitted, not
 * yet in a ledger"). The transaction may still land until its time bound passes, so the caller must not treat it as
 * failed: retrying would build a second transaction and pay twice. Look it up on chain once the time bound is over.
 */
export class SubmitOutcomeUnknownError extends Error {
  constructor(readonly txHash: string, cause: unknown) {
    super(`Submission outcome unknown for ${txHash}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'SubmitOutcomeUnknownError';
  }
}

/** Horizon's per-transaction verdict, e.g. { transaction: 'tx_failed', operations: ['op_underfunded'] }. */
export interface ResultCodes { transaction?: string; operations?: string[] }

/**
 * Horizon answered and refused the transaction: a definite failure, nothing landed. The client sees a plain message
 * and the most specific result code (public protocol values like op_underfunded, which say what to fix); Horizon's
 * raw payload stays in the log.
 */
export class HorizonRejectedError extends ExternalServiceError {
  constructor(readonly resultCodes: ResultCodes, cause: unknown) {
    const code = resultCodes.operations?.find((c) => c !== 'op_success') ?? resultCodes.transaction ?? 'horizon_rejected';
    super('Stellar', 'The Stellar network rejected the transaction', code, { cause });
    this.name = 'HorizonRejectedError';
  }
}

/**
 * Called with a signed transaction's hash and time bound just BEFORE it is submitted, so the caller can record what
 * is about to be sent (write-ahead). If it throws, nothing is submitted. Once the hash is stored, a crash, a timeout or
 * a lost database write can never hide a payment: the watchdog looks that hash up after `maxTime`, when the chain's
 * answer is final.
 */
export type OnSigned = (hash: string, maxTime: Date) => Promise<void>;

// ── Fees and reserves ─────────────────────────────────────────────────────────

/** The network's base reserve: each account entry, trustline or sponsorship locks this much XLM (0.5 XLM). */
const BASE_RESERVE_STROOPS = 5_000_000n;
/** Stellar's largest trustline limit (2^63 - 1 stroops); the maximum avoids running out on high-denomination currencies. */
const MAX_TRUST_LIMIT = '922337203685';

/** The fee bid per operation: ten times the network's current base fee, so a busy network does not delay a payment. */
async function networkFee(): Promise<string> {
  return String(Math.max((await horizon.fetchBaseFee()) * 10, 100));
}

/** XLM the account holds above its minimum balance and open-offer liabilities, in stroops (exact); 0 when none. */
function freeNative(account: Horizon.AccountResponse): bigint {
  const native = account.balances.find((b): b is Horizon.HorizonApi.BalanceLineNative => b.asset_type === 'native');
  if (!native) return 0n;
  const entries = 2n + BigInt(account.subentry_count) + BigInt(account.num_sponsoring ?? 0) - BigInt(account.num_sponsored ?? 0);
  const free = toStroops(native.balance) - toStroops(native.selling_liabilities) - entries * BASE_RESERVE_STROOPS;
  return free > 0n ? free : 0n;
}

/**
 * The platform account that pays the reserves of the worker accounts it creates, and the fees of accounts that hold no
 * XLM of their own (so a worker paid only in USDC can still claim and cash out). A dedicated key, never the contract
 * admin or an employer's wallet.
 */
function sponsorKeypair(): Keypair {
  const secret = process.env.STELLAR_SPONSOR_SECRET;
  if (!secret) throw new AppError(503, 'Account sponsorship is not configured', 'sponsor_not_configured');
  return Keypair.fromSecret(secret);
}

/** The sponsor's public key when one is configured (for monitoring its balance), else null. */
export function sponsorPublicKey(): string | null {
  return process.env.STELLAR_SPONSOR_SECRET ? Keypair.fromSecret(process.env.STELLAR_SPONSOR_SECRET).publicKey() : null;
}

/**
 * What to submit for a signed transaction: the transaction itself when its source can pay its own fee, or a fee bump in
 * which the sponsor pays it. The bump bids the inner transaction's whole fee per operation, which always meets the
 * network's minimum (the inner per-operation inclusion fee); the network charges only what is due. A fee bump does not
 * use the sponsor's sequence number, so it needs no lock on the sponsor.
 */
export function feeEnvelope(tx: Transaction, sourceFreeStroops: bigint): Transaction | FeeBumpTransaction {
  if (sourceFreeStroops >= BigInt(tx.fee)) return tx;
  return buildFeeBump(tx, sponsorKeypair(), NETWORK_PASSPHRASE);
}

/** The sponsor's fee bump around `tx`, signed. Pure, so the mainnet dry run builds exactly what production sends. */
export function buildFeeBump(tx: Transaction, sponsor: Keypair, networkPassphrase: string): FeeBumpTransaction {
  const bump = TransactionBuilder.buildFeeBumpTransaction(sponsor, tx.fee, tx, networkPassphrase);
  bump.sign(sponsor);
  return bump;
}

/** feeEnvelope for a source known only by its key (the escrow contract calls); an account not yet on chain has nothing. */
export async function feeEnvelopeFor(tx: Transaction, sourcePublicKey: string): Promise<Transaction | FeeBumpTransaction> {
  let free = 0n;
  try {
    free = freeNative(await horizon.loadAccount(sourcePublicKey));
  } catch (err: any) {
    if (err?.response?.status !== 404) throw err;
  }
  return feeEnvelope(tx, free);
}

/**
 * Submits a transaction and clears the cached balances of every account it touched, so the next balance read
 * (the wallet, the dashboard) shows the result of the user's own action instead of a figure up to 20 seconds old.
 * `sourceFreeStroops` is the source's spendable XLM: when it cannot cover the fee, the sponsor pays it (feeEnvelope).
 * The hash recorded and returned is that of what was actually submitted. A Horizon answer (4xx) is a definite failure,
 * rethrown as HorizonRejectedError; no answer is not.
 */
async function submitAndRefresh(tx: Transaction, onSigned: OnSigned | undefined, sourceFreeStroops: bigint) {
  const envelope = feeEnvelope(tx, sourceFreeStroops);
  const hash = envelope.hash().toString('hex');
  if (onSigned) await onSigned(hash, new Date(Number(tx.timeBounds!.maxTime) * 1000));
  let result;
  try {
    result = await horizon.submitTransaction(envelope);
  } catch (err: any) {
    const status: number | undefined = err?.response?.status;
    if (status === undefined || status >= 500) throw new SubmitOutcomeUnknownError(hash, err);
    throw new HorizonRejectedError(err?.response?.data?.extras?.result_codes ?? {}, err);
  }
  await forgetBalances(...accountsTouchedBy(envelope));
  return result;
}

// Short TTL cache-aside on top of Horizon — balances only change on confirmed
// payments (~5s Stellar settlement), so this doesn't meaningfully stale the
// data while cutting repeated Horizon calls under dashboard polling.
const BALANCE_CACHE_TTL_SECONDS = 20;

export async function getAccountBalance(
  publicKey: string,
): Promise<Array<Horizon.HorizonApi.BalanceLine>> {
  const cacheKey = balanceCacheKey(publicKey);
  const cached = await getJSON<Array<Horizon.HorizonApi.BalanceLine>>(cacheKey).catch(() => null);
  if (cached) return cached;

  const account = await horizon.loadAccount(publicKey);
  await setJSON(cacheKey, account.balances, BALANCE_CACHE_TTL_SECONDS).catch(() => {});
  return account.balances;
}

/** How much of an issued asset the account can spend: its balance less what open DEX offers have reserved. */
export async function spendableAsset(publicKey: string, code: string, issuer: string): Promise<bigint> {
  const account = await horizon.loadAccount(publicKey);
  const line = account.balances.find(
    (b): b is Horizon.HorizonApi.BalanceLineAsset => 'asset_code' in b && b.asset_code === code && b.asset_issuer === issuer,
  );
  if (!line) return 0n;
  const spendable = toStroops(line.balance) - toStroops(line.selling_liabilities);
  return spendable > 0n ? spendable : 0n;
}

/**
 * Makes sure the account can spend at least `amount` of an issued asset: opens the trustline if missing, then buys any
 * shortfall with the account's XLM through the DEX (a strict-receive path payment to itself, at most `slippage` above
 * the quoted price). Returns the XLM spent, or null when the balance already covered it. Read live, not cached: it
 * gates a payment.
 */
export async function ensureAssetBalance(
  secret: string, code: string, issuer: string, amount: string, slippage = 0.05,
): Promise<{ spentXlm: string | null }> {
  await ensureTrustline(secret, code, issuer);
  const pub = Keypair.fromSecret(secret).publicKey();
  const shortfall = toStroops(amount) - (await spendableAsset(pub, code, issuer));
  if (shortfall <= 0n) return { spentXlm: null };
  const { sourceAmountXlm } = await payExactWithXlm(secret, pub, code, issuer, fromStroops(shortfall), slippage);
  logger.info('Bought the shortfall with XLM', { account: pub, code, amount: fromStroops(shortfall), spentXlm: sourceAmountXlm });
  return { spentXlm: sourceAmountXlm };
}

/** Network fee headroom kept back so a cash-out never leaves the account unable to pay its next fee. */
const FEE_BUFFER_XLM = 0.5;

/**
 * XLM the account can actually spend right now: the native balance less the network's
 * minimum balance (0.5 XLM per base/sub-entry/sponsorship), open DEX offers and a small
 * fee buffer. Read live from Horizon, not the 20s balance cache — it gates real payments.
 */
export async function spendableXlm(publicKey: string): Promise<number> {
  const free = Number(fromStroops(freeNative(await horizon.loadAccount(publicKey))));
  return Math.max(0, Math.floor((free - FEE_BUFFER_XLM) * 1e7) / 1e7);
}

/**
 * What the account's owner would lose if its key were destroyed: every asset other than XLM with a balance, plus
 * spendable XLM on mainnet. Testnet XLM is Friendbot's grant, not the owner's money, so it does not count there.
 * Read live from Horizon. An account that was never funded holds nothing.
 */
export async function balancesHeld(publicKey: string): Promise<Array<{ asset: string; amount: number }>> {
  let account: any;
  try {
    account = await horizon.loadAccount(publicKey);
  } catch (err: any) {
    if (err?.response?.status === 404) return [];
    throw err;
  }
  const held = (account.balances as Horizon.HorizonApi.BalanceLine[])
    .filter((b) => b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares' && Number(b.balance) > 0)
    .map((b) => ({ asset: (b as Horizon.HorizonApi.BalanceLineAsset).asset_code, amount: Number(b.balance) }));
  if (stellarNetwork().isMainnet) {
    const xlm = await spendableXlm(publicKey);
    if (xlm > 0) held.unshift({ asset: 'XLM', amount: xlm });
  }
  return held;
}

/**
 * Stellar accepts one transaction per account at a time: each carries the account's next sequence number, so two
 * submitted at once (two admins paying, the scheduler plus a manual send) collide and one fails with tx_bad_seq.
 * Every submission from a given source account therefore runs under a cluster-wide lock named after it, and loads
 * the account fresh inside the lock.
 */
const accountLock = <T>(secret: string, fn: () => Promise<T>): Promise<T> =>
  withAdvisoryLock(`stellar:${Keypair.fromSecret(secret).publicKey()}`, fn);

// ── Classic Stellar payments ──────────────────────────────────────────────────

async function sendPaymentUnlocked(
  sourceSecret: string,
  destinationPublic: string,
  amount: string,
  assetCode: string = 'XLM',
  assetIssuer?: string,
  // Buffer = sha256 hash memo (the payout convention); a prebuilt Memo covers
  // anchor-dictated memo types (id/text) for settlement payments.
  memoHash?: Buffer | Memo,
  onSigned?: OnSigned,
): Promise<string> {
  const sourceKeypair = Keypair.fromSecret(sourceSecret);
  logger.info('Preparing payment', {
    from: sourceKeypair.publicKey(),
    to: destinationPublic,
    amount,
    assetCode,
  });

  const account = await horizon.loadAccount(sourceKeypair.publicKey());
  const asset = assetCode === 'XLM' ? Asset.native() : new Asset(assetCode, assetIssuer!);

  const builder = new TransactionBuilder(account, {
    fee: await networkFee(),
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  if (memoHash) {
    builder.addMemo(Buffer.isBuffer(memoHash) ? Memo.hash(memoHash) : memoHash);
  }

  const tx = builder
    .addOperation(Operation.payment({ destination: destinationPublic, asset, amount }))
    .setTimeout(60)
    .build();

  tx.sign(sourceKeypair);
  const result = await submitAndRefresh(tx, onSigned, freeNative(account));
  logger.info('Payment submitted', { hash: result.hash });
  return result.hash;
}

export async function checkTrustline(
  publicKey: string,
  assetCode: string,
  assetIssuer: string,
): Promise<boolean> {
  try {
    const account = await horizon.loadAccount(publicKey);
    return account.balances.some((b) => {
      if ('asset_code' in b && 'asset_issuer' in b) {
        return b.asset_code === assetCode && b.asset_issuer === assetIssuer;
      }
      return false;
    });
  } catch (err) {
    logger.warn('Failed to check trustline', { publicKey, assetCode, error: String(err) });
    return false;
  }
}

/**
 * Opens a trustline. An account that cannot lock the 0.5 XLM reserve itself (one the platform created, holding no XLM)
 * has it sponsored: the sponsor co-signs a begin/end sponsoring pair around the trustline, and pays the fee too. The
 * transaction stays the account's own (its sequence number, under its lock), so the sponsor needs no lock here.
 */
async function addTrustlineUnlocked(
  accountSecret: string,
  assetCode: string,
  assetIssuer: string,
): Promise<void> {
  const keypair = Keypair.fromSecret(accountSecret);
  const account = await horizon.loadAccount(keypair.publicKey());
  const fee = await networkFee();
  const free = freeNative(account);
  const changeTrust = Operation.changeTrust({ asset: new Asset(assetCode, assetIssuer), limit: MAX_TRUST_LIMIT });
  const sponsored = free < BASE_RESERVE_STROOPS + BigInt(fee) * 3n;

  const builder = new TransactionBuilder(account, { fee, networkPassphrase: NETWORK_PASSPHRASE });
  const sponsor = sponsored ? sponsorKeypair() : null;
  if (sponsor) {
    builder
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: keypair.publicKey(), source: sponsor.publicKey() }))
      .addOperation(changeTrust)
      .addOperation(Operation.endSponsoringFutureReserves({}));
  } else {
    builder.addOperation(changeTrust);
  }
  const tx = builder.setTimeout(60).build();
  tx.sign(keypair);
  if (sponsor) tx.sign(sponsor);

  try {
    await submitAndRefresh(tx, undefined, free);
  } catch (err) {
    // A trustline only prepares a payment: with no verdict it is a plain failure, retried by checking again first.
    if (err instanceof SubmitOutcomeUnknownError) {
      throw new ExternalServiceError('Stellar', 'Could not confirm the trustline was opened; try again shortly', 'trustline_unconfirmed', { cause: err });
    }
    throw err;
  }
  logger.info('Trustline established', { account: keypair.publicKey(), asset: assetCode, sponsored });
}

export async function ensureTrustline(
  accountSecret: string,
  assetCode: string,
  assetIssuer: string,
): Promise<void> {
  const keypair = Keypair.fromSecret(accountSecret);
  const hasTrustline = await checkTrustline(keypair.publicKey(), assetCode, assetIssuer);
  if (!hasTrustline) {
    logger.info('Trustline missing, creating...', { account: keypair.publicKey(), asset: assetCode });
    await addTrustline(accountSecret, assetCode, assetIssuer);
  } else {
    logger.info('Trustline already exists', { account: keypair.publicKey(), asset: assetCode });
  }
}

/**
 * Cross-asset payout: the source spends native XLM and the destination receives
 * an EXACT amount of `destAsset` (e.g. USDC), routed through the Stellar DEX via
 * a strict-receive path payment. Returns the tx hash and how much XLM was spent.
 *
 * The destination must already hold a trustline to destAsset.
 *
 * `sendMaxXlm` is a hard ceiling on the XLM spent (the network rejects the payment
 * if the DEX would need more) — pass it to cap a payout at a known amount instead
 * of relying on the default price-plus-slippage ceiling. `memo` overrides the
 * default hash memo (e.g. a numeric ID memo an anchor requires).
 */
async function payExactWithXlmUnlocked(
  sourceSecret: string,
  destinationPublic: string,
  destAssetCode: string,
  destAssetIssuer: string,
  destAmount: string,
  slippage = 0.05,
  memoHash?: Buffer,
  options: { sendMaxXlm?: string; memo?: Memo; onSigned?: OnSigned } = {},
): Promise<{ hash: string; sourceAmountXlm: string }> {
  const sourceKeypair = Keypair.fromSecret(sourceSecret);
  const destAsset = new Asset(destAssetCode, destAssetIssuer);

  // Find the cheapest path that delivers `destAmount` of destAsset.
  const paths = await horizon
    .strictReceivePaths(sourceKeypair.publicKey(), destAsset, destAmount)
    .call();
  if (!paths.records || paths.records.length === 0) {
    throw new AppError(422, `No DEX path to deliver ${destAmount} ${destAssetCode}`, 'no_dex_path');
  }
  // Only paths that START in XLM: the payment below spends native XLM. Without this
  // filter a sender who also holds the destination asset (or any other) would match
  // their own cheaper non-XLM path and we would build a payment that can't succeed.
  const xlmPaths = paths.records.filter((r) => r.source_asset_type === 'native');
  if (xlmPaths.length === 0) {
    throw new AppError(422, `No DEX path from XLM to deliver ${destAmount} ${destAssetCode}`, 'no_dex_path');
  }
  const best = xlmPaths.reduce((a, b) =>
    Number(a.source_amount) <= Number(b.source_amount) ? a : b,
  );
  const sendMax = options.sendMaxXlm ?? (Number(best.source_amount) * (1 + slippage)).toFixed(7);
  if (Number(best.source_amount) > Number(sendMax)) {
    throw new AppError(422, `Delivering ${destAmount} ${destAssetCode} needs ${best.source_amount} XLM, above the ${sendMax} XLM limit`, 'exceeds_send_max');
  }

  const account = await horizon.loadAccount(sourceKeypair.publicKey());
  const builder = new TransactionBuilder(account, {
    fee: await networkFee(),
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  if (options.memo) builder.addMemo(options.memo);
  else if (memoHash) builder.addMemo(Memo.hash(memoHash));

  const path = (best.path || []).map((p: any) =>
    p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code, p.asset_issuer),
  );

  const tx = builder
    .addOperation(
      Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax,
        destination: destinationPublic,
        destAsset,
        destAmount,
        path,
      }),
    )
    .setTimeout(60)
    .build();

  tx.sign(sourceKeypair);
  const result = await submitAndRefresh(tx, options.onSigned, freeNative(account));
  logger.info('Cross-asset payout submitted', {
    hash: result.hash,
    destAmount,
    destAssetCode,
    sourceAmountXlm: best.source_amount,
  });
  return { hash: result.hash, sourceAmountXlm: best.source_amount };
}

// ── Claimable balances ────────────────────────────────────────────────────────

/**
 * Create a claimable balance payable to `claimantPublic`. Use this as a fallback
 * when the destination account lacks the required trustline — the worker can claim
 * the balance later once their wallet is configured.
 *
 * @returns The transaction hash of the claimable-balance creation.
 */
async function createClaimableBalanceUnlocked(
  sourceSecret: string,
  claimantPublic: string,
  asset: Asset,
  amount: string,
  memoHash?: Buffer,
  onSigned?: OnSigned,
): Promise<string> {
  const keypair = Keypair.fromSecret(sourceSecret);
  const account = await horizon.loadAccount(keypair.publicKey());

  const builder = new TransactionBuilder(account, {
    fee: await networkFee(),
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  if (memoHash) builder.addMemo(Memo.hash(memoHash));

  const tx = builder
    .addOperation(
      Operation.createClaimableBalance({
        asset,
        amount,
        claimants: [new Claimant(claimantPublic, Claimant.predicateUnconditional())],
      }),
    )
    .setTimeout(60)
    .build();

  tx.sign(keypair);
  const result = await submitAndRefresh(tx, onSigned, freeNative(account));
  logger.info('Claimable balance created', {
    claimant: claimantPublic,
    asset: asset.code || 'XLM',
    amount,
    hash: result.hash,
  });
  return result.hash;
}

// ── Sponsored accounts ────────────────────────────────────────────────────────

/**
 * The transaction that creates `account` with no XLM of its own, plus its trustlines, every reserve paid by the sponsor
 * (1 XLM for the account, 0.5 XLM per trustline). The sponsor is the source and pays the fee; both sign. Pure: it builds
 * and signs, never submits, so the mainnet dry run uses exactly what production sends.
 */
export function buildSponsoredAccountTx(o: {
  /** The sponsor's account (its sequence number): a Horizon response, or an Account for a dry run. */
  sponsorAccount: ConstructorParameters<typeof TransactionBuilder>[0];
  sponsor: Keypair;
  account: Keypair;
  trustlines: Array<{ code: string; issuer: string }>;
  fee: string;
  networkPassphrase: string;
}): Transaction {
  const id = o.account.publicKey();
  const builder = new TransactionBuilder(o.sponsorAccount, { fee: o.fee, networkPassphrase: o.networkPassphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: id }))
    .addOperation(Operation.createAccount({ destination: id, startingBalance: '0' }));
  for (const t of o.trustlines) {
    builder.addOperation(Operation.changeTrust({ asset: new Asset(t.code, t.issuer), limit: MAX_TRUST_LIMIT, source: id }));
  }
  const tx = builder.addOperation(Operation.endSponsoringFutureReserves({ source: id })).setTimeout(60).build();
  tx.sign(o.sponsor, o.account);
  return tx;
}

/** The XLM the sponsor locks for one sponsored account with `trustlines` trustlines. */
export function sponsoredReserveXlm(trustlines: number): string {
  return fromStroops(BASE_RESERVE_STROOPS * BigInt(2 + trustlines));
}

async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await horizon.loadAccount(publicKey);
    return true;
  } catch (err: any) {
    if (err?.response?.status === 404) return false;
    throw err;
  }
}

/**
 * Makes sure the custodial account exists on chain, with the given trustlines. A missing account is created by the
 * sponsor, which pays every reserve (the owner needs no XLM), under the sponsor's lock so two creations never collide;
 * an existing one only gets any missing trustline (sponsored when it holds no XLM). Idempotent. A creation that gets no
 * verdict is a plain failure: the next call checks the chain again before creating anything.
 */
export async function activateAccount(
  accountSecret: string,
  trustlines: Array<{ code: string; issuer: string }>,
): Promise<{ created: boolean; hash?: string }> {
  const account = Keypair.fromSecret(accountSecret);
  const sponsor = sponsorKeypair();
  let hash: string | null;
  try {
    hash = await withAdvisoryLock(`stellar:${sponsor.publicKey()}`, async () => {
      if (await accountExists(account.publicKey())) return null;
      const sponsorAccount = await horizon.loadAccount(sponsor.publicKey());
      const tx = buildSponsoredAccountTx({
        sponsorAccount, sponsor, account, trustlines, fee: await networkFee(), networkPassphrase: NETWORK_PASSPHRASE,
      });
      return (await submitAndRefresh(tx, undefined, freeNative(sponsorAccount))).hash;
    });
  } catch (err) {
    if (err instanceof SubmitOutcomeUnknownError) {
      throw new ExternalServiceError('Stellar', 'Could not confirm the account was created; try again shortly', 'account_activation_unconfirmed', { cause: err });
    }
    throw err;
  }
  if (hash) {
    logger.info('Created a sponsored account', { account: account.publicKey(), trustlines: trustlines.map((t) => t.code), hash });
    return { created: true, hash };
  }
  for (const t of trustlines) await ensureTrustline(accountSecret, t.code, t.issuer);
  return { created: false };
}

// ── Serialized entry points (per source account) ──────────────────────────────

/** Same function, but runs under the lock of the account named by its first argument (the signing secret). */
function serialized<A extends [string, ...unknown[]], R>(fn: (...args: A) => Promise<R>) {
  return (...args: A): Promise<R> => accountLock(args[0], () => fn(...args));
}

/** Pages of 200 a lookup reads before giving up; past this it throws rather than answer "not sent" unchecked. */
const MEMO_SEARCH_MAX_PAGES = 50;

/**
 * The successful transaction from `account` carrying `Memo.hash(memoHash)`, searched newest-first back to `since`,
 * or null. Each payout's transaction is tagged with sha256(paymentId), so this is the chain's answer to "did this
 * payment happen?", conclusive once every transaction built for it is past its time bound. `claimable` marks the
 * claimable-balance fallback. Throws if Horizon cannot be read (or the history is too deep to search), so a caller
 * never mistakes "could not check" for "not sent".
 */
export async function findTransactionByMemoHash(
  account: string,
  memoHash: Buffer,
  since: Date,
): Promise<{ hash: string; claimable: boolean } | null> {
  const wanted = memoHash.toString('base64');
  let page;
  try {
    page = await horizon.transactions().forAccount(account).order('desc').limit(200).call();
  } catch (err: any) {
    if (err?.response?.status === 404) return null; // account never funded: nothing can have been sent
    throw err;
  }
  for (let pages = 1; page.records.length > 0; pages++) {
    for (const tx of page.records) {
      if (new Date(tx.created_at) < since) return null;
      // Horizon lists only successful transactions here unless asked for failed ones. The account's history also holds
      // transactions others sent TO it; only one it signed itself can be the payout, or anyone who knows the payment id
      // could mark it paid by sending the employer a dust payment with the same memo.
      if (tx.source_account === account && tx.memo_type === 'hash' && tx.memo === wanted) {
        const ops = await horizon.operations().forTransaction(tx.hash).call();
        return { hash: tx.hash, claimable: ops.records.some((op) => op.type === 'create_claimable_balance') };
      }
    }
    if (pages >= MEMO_SEARCH_MAX_PAGES) throw new Error(`Searched ${pages * 200} transactions of ${account} without reaching ${since.toISOString()}`);
    page = await page.next();
  }
  return null;
}

/**
 * What Horizon knows about a transaction hash: missing (never landed), or whether it succeeded and the memo it carried.
 * Throws if Horizon cannot be read, so a caller never mistakes "could not check" for "missing".
 */
export async function lookupTransaction(
  hash: string,
): Promise<{ found: false } | { found: true; successful: boolean; memoType: string; memo?: string }> {
  try {
    const tx = await horizon.transactions().transaction(hash).call();
    return { found: true, successful: tx.successful, memoType: tx.memo_type, memo: tx.memo };
  } catch (err: any) {
    if (err?.response?.status === 404) return { found: false };
    throw err;
  }
}

/**
 * The chain's verdict on a payout transaction by its hash: not there (never landed), landed but failed, or succeeded,
 * with `claimable` marking the claimable-balance fallback. Throws if Horizon cannot be read, so a caller never
 * mistakes "could not check" for "missing".
 */
export async function payoutOutcome(
  hash: string,
): Promise<{ found: false } | { found: true; successful: boolean; claimable: boolean }> {
  const tx = await lookupTransaction(hash);
  if (!tx.found) return { found: false };
  if (!tx.successful) return { found: true, successful: false, claimable: false };
  const ops = await horizon.operations().forTransaction(hash).call();
  return { found: true, successful: true, claimable: ops.records.some((op) => op.type === 'create_claimable_balance') };
}

export const sendPayment = serialized(sendPaymentUnlocked);
export const addTrustline = serialized(addTrustlineUnlocked);
export const payExactWithXlm = serialized(payExactWithXlmUnlocked);
export const createClaimableBalance = serialized(createClaimableBalanceUnlocked);
