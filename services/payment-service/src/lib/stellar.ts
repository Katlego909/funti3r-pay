import {
  Horizon,
  Keypair,
  Asset,
  Claimant,
  Operation,
  TransactionBuilder,
  Transaction,
  Networks,
  Memo,
} from '@stellar/stellar-sdk';
import { createLogger } from '@funti3r/shared-utils';
import { getRedis, getJSON, setJSON, withAdvisoryLock } from '@funti3r/database';
import axios from 'axios';

const logger = createLogger('StellarService');

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === 'MAINNET' ? Networks.PUBLIC : Networks.TESTNET;

const horizon = new Horizon.Server(HORIZON_URL);

export interface StellarKeypair {
  publicKey: string;
  secretKey: string;
}

// ── Keypair & funding ─────────────────────────────────────────────────────────

export function createKeypair(): StellarKeypair {
  const pair = Keypair.random();
  return { publicKey: pair.publicKey(), secretKey: pair.secret() };
}

export async function fundWithFriendbot(publicKey: string): Promise<void> {
  logger.info('Funding account via Friendbot', { publicKey });
  try {
    await axios.get(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`, { timeout: 10000 });
    logger.info('Account funded', { publicKey });
  } catch (err) {
    logger.warn('Friendbot funding failed (account may be funded manually)', { publicKey, error: String(err) });
  }
}

// Short TTL cache-aside on top of Horizon — balances only change on confirmed
// payments (~5s Stellar settlement), so this doesn't meaningfully stale the
// data while cutting repeated Horizon calls under dashboard polling.
const BALANCE_CACHE_TTL_SECONDS = 20;

export async function getAccountBalance(
  publicKey: string,
): Promise<Array<Horizon.HorizonApi.BalanceLine>> {
  const cacheKey = `stellar:balance:${publicKey}`;
  const cached = await getJSON<Array<Horizon.HorizonApi.BalanceLine>>(cacheKey).catch(() => null);
  if (cached) return cached;

  const account = await horizon.loadAccount(publicKey);
  await setJSON(cacheKey, account.balances, BALANCE_CACHE_TTL_SECONDS).catch(() => {});
  return account.balances;
}

/** Network fee headroom kept back so a cash-out never leaves the account unable to pay its next fee. */
const FEE_BUFFER_XLM = 0.5;

/**
 * XLM the account can actually spend right now: the native balance less the network's
 * minimum balance (0.5 XLM per base/sub-entry/sponsorship), open DEX offers and a small
 * fee buffer. Read live from Horizon, not the 20s balance cache — it gates real payments.
 */
export async function spendableXlm(publicKey: string): Promise<number> {
  const account: any = await horizon.loadAccount(publicKey);
  const native = account.balances.find((b: Horizon.HorizonApi.BalanceLine) => b.asset_type === 'native');
  if (!native) return 0;
  const entries = 2 + Number(account.subentry_count ?? 0) + Number(account.num_sponsoring ?? 0) - Number(account.num_sponsored ?? 0);
  const spendable = Number(native.balance) - Number((native as any).selling_liabilities ?? 0) - entries * 0.5 - FEE_BUFFER_XLM;
  return Math.max(0, Math.floor(spendable * 1e7) / 1e7);
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
): Promise<string> {
  const sourceKeypair = Keypair.fromSecret(sourceSecret);
  logger.info('Preparing payment', {
    from: sourceKeypair.publicKey(),
    to: destinationPublic,
    amount,
    assetCode,
  });

  const account = await horizon.loadAccount(sourceKeypair.publicKey());
  const fee = await horizon.fetchBaseFee();
  const asset = assetCode === 'XLM' ? Asset.native() : new Asset(assetCode, assetIssuer!);

  const builder = new TransactionBuilder(account, {
    fee: String(Math.max(fee * 10, 100)),
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
  const result = await horizon.submitTransaction(tx);
  logger.info('Payment submitted', { hash: result.hash });
  return result.hash;
}

async function pathPaymentStrictSendUnlocked(
  sourceSecret: string,
  destinationPublic: string,
  sendAsset: Asset,
  sendAmount: string,
  destAsset: Asset,
  slippage = 0.02,
  memoHash?: Buffer,
): Promise<string> {
  const sourceKeypair = Keypair.fromSecret(sourceSecret);

  // Discover the best DEX route and expected output before building the tx.
  const pathsResult = await horizon
    .strictSendPaths(sendAsset, sendAmount, [destAsset])
    .call();

  if (!pathsResult.records || pathsResult.records.length === 0) {
    throw new Error(
      `No DEX path found: ${sendAsset.code || 'XLM'} → ${destAsset.code || 'XLM'} for amount ${sendAmount}`,
    );
  }

  // Pick the path that delivers the most to the destination.
  const best = pathsResult.records.reduce((a, b) =>
    Number(a.destination_amount) >= Number(b.destination_amount) ? a : b,
  );

  // Guard against slippage: reject if the network moves more than `slippage` against us.
  const destMin = (Number(best.destination_amount) * (1 - slippage)).toFixed(7);
  const explicitPath = (best.path || []).map((p: any) =>
    p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code, p.asset_issuer),
  );

  logger.info('Path payment route selected', {
    from: sourceKeypair.publicKey(),
    to: destinationPublic,
    sendAmount,
    sendAsset: sendAsset.code || 'XLM',
    destAsset: destAsset.code || 'XLM',
    expectedDestAmount: best.destination_amount,
    destMin,
    hops: explicitPath.length,
  });

  const account = await horizon.loadAccount(sourceKeypair.publicKey());
  const fee = await horizon.fetchBaseFee();

  const builder = new TransactionBuilder(account, {
    fee: String(Math.max(fee * 10, 100)),
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  if (memoHash) builder.addMemo(Memo.hash(memoHash));

  const tx = builder
    .addOperation(
      Operation.pathPaymentStrictSend({
        destination: destinationPublic,
        sendAsset,
        sendAmount,
        destAsset,
        destMin,
        path: explicitPath,
      }),
    )
    .setTimeout(60)
    .build();

  tx.sign(sourceKeypair);
  const result = await horizon.submitTransaction(tx);
  logger.info('Path payment submitted', { hash: result.hash });
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

async function addTrustlineUnlocked(
  accountSecret: string,
  assetCode: string,
  assetIssuer: string,
): Promise<void> {
  const keypair = Keypair.fromSecret(accountSecret);
  const account = await horizon.loadAccount(keypair.publicKey());
  const fee = await horizon.fetchBaseFee();

  const tx = new TransactionBuilder(account, {
    fee: String(Math.max(fee * 10, 100)),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      // 922337203685 is Stellar's max trustline limit (2^63 - 1 stroops in XLM units).
      // Using max avoids limit exhaustion for high-denomination local currencies (e.g. UGX).
      Operation.changeTrust({ asset: new Asset(assetCode, assetIssuer), limit: '922337203685' }),
    )
    .setTimeout(60)
    .build();

  tx.sign(keypair);
  await horizon.submitTransaction(tx);
  logger.info('Trustline established', { account: keypair.publicKey(), asset: assetCode });
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
  options: { sendMaxXlm?: string; memo?: Memo } = {},
): Promise<{ hash: string; sourceAmountXlm: string }> {
  const sourceKeypair = Keypair.fromSecret(sourceSecret);
  const destAsset = new Asset(destAssetCode, destAssetIssuer);

  // Find the cheapest path that delivers `destAmount` of destAsset.
  const paths = await horizon
    .strictReceivePaths(sourceKeypair.publicKey(), destAsset, destAmount)
    .call();
  if (!paths.records || paths.records.length === 0) {
    throw new Error(`No DEX path to deliver ${destAmount} ${destAssetCode}`);
  }
  // Only paths that START in XLM: the payment below spends native XLM. Without this
  // filter a sender who also holds the destination asset (or any other) would match
  // their own cheaper non-XLM path and we would build a payment that can't succeed.
  const xlmPaths = paths.records.filter((r) => r.source_asset_type === 'native');
  if (xlmPaths.length === 0) {
    throw new Error(`No DEX path from XLM to deliver ${destAmount} ${destAssetCode}`);
  }
  const best = xlmPaths.reduce((a, b) =>
    Number(a.source_amount) <= Number(b.source_amount) ? a : b,
  );
  const sendMax = options.sendMaxXlm ?? (Number(best.source_amount) * (1 + slippage)).toFixed(7);
  if (Number(best.source_amount) > Number(sendMax)) {
    throw new Error(`Delivering ${destAmount} ${destAssetCode} needs ${best.source_amount} XLM, above the ${sendMax} XLM limit`);
  }

  const account = await horizon.loadAccount(sourceKeypair.publicKey());
  const fee = await horizon.fetchBaseFee();
  const builder = new TransactionBuilder(account, {
    fee: String(Math.max(fee * 10, 100)),
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
  const result = await horizon.submitTransaction(tx);
  logger.info('Cross-asset payout submitted', {
    hash: result.hash,
    destAmount,
    destAssetCode,
    sourceAmountXlm: best.source_amount,
  });
  return { hash: result.hash, sourceAmountXlm: best.source_amount };
}

// ── Unsigned transactions for external wallet signing ──────────────────────────

/**
 * Prepare an unsigned payment transaction for external wallet signing.
 * Returns the transaction XDR that the wallet will sign.
 */
export async function prepareUnsignedPayment(
  sourcePublic: string,
  destinationPublic: string,
  amount: string,
  assetCode: string = 'XLM',
  assetIssuer?: string,
  memoHash?: Buffer,
): Promise<string> {
  logger.info('Preparing unsigned payment', {
    from: sourcePublic,
    to: destinationPublic,
    amount,
    assetCode,
  });

  const account = await horizon.loadAccount(sourcePublic);
  const fee = await horizon.fetchBaseFee();
  const asset = assetCode === 'XLM' ? Asset.native() : new Asset(assetCode, assetIssuer!);

  const builder = new TransactionBuilder(account, {
    fee: String(Math.max(fee * 10, 100)),
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  if (memoHash) {
    builder.addMemo(Memo.hash(memoHash));
  }

  const tx = builder
    .addOperation(Operation.payment({ destination: destinationPublic, asset, amount }))
    .setTimeout(60)
    .build();

  return tx.toXDR();
}

/**
 * Prepare an unsigned path payment transaction for external wallet signing.
 * Queries the DEX to find the best route and applies `slippage` tolerance
 * so the worker is guaranteed to receive at least (1 - slippage) × expected amount.
 */
export async function prepareUnsignedPathPayment(
  sourcePublic: string,
  destinationPublic: string,
  sendAsset: Asset,
  sendAmount: string,
  destAsset: Asset,
  slippage = 0.05,
  memoHash?: Buffer,
): Promise<string> {
  logger.info('Preparing unsigned path payment', {
    from: sourcePublic,
    to: destinationPublic,
    sendAmount,
    sendAssetCode: sendAsset.code || 'XLM',
    destAssetCode: destAsset.code || 'XLM',
  });

  // Query the DEX so we can set a meaningful minimum destination amount.
  const pathsResult = await horizon
    .strictSendPaths(sendAsset, sendAmount, [destAsset])
    .call();

  if (!pathsResult.records || pathsResult.records.length === 0) {
    throw new Error(
      `No DEX path found: ${sendAsset.code || 'XLM'} → ${destAsset.code || 'XLM'} for amount ${sendAmount}`,
    );
  }

  const best = pathsResult.records.reduce((a, b) =>
    Number(a.destination_amount) >= Number(b.destination_amount) ? a : b,
  );
  const destMin = (Number(best.destination_amount) * (1 - slippage)).toFixed(7);
  const explicitPath = (best.path || []).map((p: any) =>
    p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code, p.asset_issuer),
  );

  logger.info('Unsigned path payment route selected', {
    expectedDestAmount: best.destination_amount,
    destMin,
    hops: explicitPath.length,
  });

  const account = await horizon.loadAccount(sourcePublic);
  const fee = await horizon.fetchBaseFee();

  const builder = new TransactionBuilder(account, {
    fee: String(Math.max(fee * 10, 100)),
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  if (memoHash) {
    builder.addMemo(Memo.hash(memoHash));
  }

  const tx = builder
    .addOperation(
      Operation.pathPaymentStrictSend({
        destination: destinationPublic,
        sendAsset,
        sendAmount,
        destAsset,
        destMin,
        path: explicitPath,
      }),
    )
    .setTimeout(60)
    .build();

  return tx.toXDR();
}

/**
 * Submit a transaction that has been signed by an external wallet.
 * @param signedXDR - The transaction XDR with signature appended
 */
export async function submitSignedTransaction(signedXDR: string): Promise<string> {
  try {
    const tx = TransactionBuilder.fromXDR(signedXDR, NETWORK_PASSPHRASE) as Transaction;
    logger.info('Submitting externally-signed transaction');
    const result = await horizon.submitTransaction(tx);
    logger.info('Externally-signed transaction submitted', { hash: result.hash });
    return result.hash;
  } catch (err) {
    logger.error('Failed to submit externally-signed transaction', { error: String(err) });
    throw err;
  }
}

// ── Fee bump ──────────────────────────────────────────────────────────────────

/**
 * Bump the fee on a stuck transaction. Call this when a submitted transaction
 * sits unconfirmed past its timeout due to a fee surge on the network.
 *
 * @param originalXDR  The XDR of the already-signed inner transaction.
 * @param feeAccountSecret  The account that pays the new fee (can be the same as sender).
 * @param newFeeStroopsPerOp  New fee per operation in stroops (e.g. 10000 = 0.001 XLM/op).
 */
export async function bumpPaymentFee(
  originalXDR: string,
  feeAccountSecret: string,
  newFeeStroopsPerOp = 10_000,
): Promise<string> {
  const feeKeypair = Keypair.fromSecret(feeAccountSecret);
  const innerTx = TransactionBuilder.fromXDR(originalXDR, NETWORK_PASSPHRASE) as Transaction;

  const totalFee = String(newFeeStroopsPerOp * innerTx.operations.length);
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    feeKeypair,
    totalFee,
    innerTx,
    NETWORK_PASSPHRASE,
  );
  feeBump.sign(feeKeypair);

  logger.info('Submitting fee-bump transaction', {
    innerHash: innerTx.hash().toString('hex'),
    newFeeStroopsPerOp,
  });

  const result = await horizon.submitTransaction(feeBump);
  logger.info('Fee-bump transaction submitted', { hash: result.hash });
  return result.hash;
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
): Promise<string> {
  const keypair = Keypair.fromSecret(sourceSecret);
  const account = await horizon.loadAccount(keypair.publicKey());
  const fee = await horizon.fetchBaseFee();

  const builder = new TransactionBuilder(account, {
    fee: String(Math.max(fee * 10, 100)),
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
  const result = await horizon.submitTransaction(tx);
  logger.info('Claimable balance created', {
    claimant: claimantPublic,
    asset: asset.code || 'XLM',
    amount,
    hash: result.hash,
  });
  return result.hash;
}

// ── Horizon streaming ─────────────────────────────────────────────────────────

export async function streamEnterprisePayments(
  enterprisePublicKey: string,
  onPayment: (hash: string) => Promise<void>,
): Promise<() => void> {
  const redis = await getRedis();
  const cursorKey = `stellar:cursor:${enterprisePublicKey}`;

  let stopped = false;
  let currentStream: { close: () => void } | null = null;

  async function connect(retryDelayMs = 1_000): Promise<void> {
    if (stopped) return;

    let cursor: string | null = null;
    try {
      cursor = await redis.get(cursorKey);
    } catch (err) {
      logger.warn('Failed to load stream cursor from Redis', { error: String(err) });
    }

    logger.info('Starting Horizon payment stream', { enterprisePublicKey, cursor, retryDelayMs });

    const stream = horizon
      .payments()
      .forAccount(enterprisePublicKey)
      .cursor(cursor ?? 'now')
      .stream({
        onmessage: async (op: Horizon.ServerApi.OperationRecord) => {
          // A successful message resets the backoff for the next reconnect.
          retryDelayMs = 1_000;

          if (op.type === 'payment' && 'transaction_hash' in op && op.transaction_hash) {
            try {
              logger.info('Payment confirmed on-chain', { hash: op.transaction_hash });
              await onPayment(op.transaction_hash);
            } catch (err) {
              logger.error('Failed to process payment event', {
                hash: op.transaction_hash,
                error: String(err),
              });
            }
          }

          if ('paging_token' in op && op.paging_token) {
            try {
              await redis.set(cursorKey, op.paging_token, { EX: 86400 * 7 });
            } catch (err) {
              logger.warn('Failed to persist cursor', { error: String(err) });
            }
          }
        },
        onerror: (err: unknown) => {
          logger.error('Horizon stream dropped — will reconnect', {
            enterprisePublicKey,
            error: String(err),
            nextRetryMs: retryDelayMs,
          });
          if (currentStream) { currentStream.close(); currentStream = null; }
          if (!stopped) {
            const nextDelay = Math.min(retryDelayMs * 2, 30_000);
            setTimeout(() => connect(nextDelay), retryDelayMs);
          }
        },
      });

    currentStream = stream as unknown as { close: () => void };
  }

  await connect();

  return () => {
    stopped = true;
    if (currentStream) currentStream.close();
  };
}

// ── Serialized entry points (per source account) ──────────────────────────────

/** Same function, but runs under the lock of the account named by its first argument (the signing secret). */
function serialized<A extends [string, ...unknown[]], R>(fn: (...args: A) => Promise<R>) {
  return (...args: A): Promise<R> => accountLock(args[0], () => fn(...args));
}

export const sendPayment = serialized(sendPaymentUnlocked);
export const pathPaymentStrictSend = serialized(pathPaymentStrictSendUnlocked);
export const addTrustline = serialized(addTrustlineUnlocked);
export const payExactWithXlm = serialized(payExactWithXlmUnlocked);
export const createClaimableBalance = serialized(createClaimableBalanceUnlocked);
