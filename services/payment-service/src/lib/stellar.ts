import {
  Horizon,
  Keypair,
  Asset,
  Operation,
  TransactionBuilder,
  Networks,
  rpc,
  Contract,
  nativeToScVal,
  Address,
  hash,
  BASE_FEE,
  Memo,
} from '@stellar/stellar-sdk';
import { createLogger } from '@funti3r/shared-utils';
import { getRedis } from '@funti3r/database';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const logger = createLogger('StellarService');

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const SOROBAN_URL =
  process.env.STELLAR_SOROBAN_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === 'MAINNET' ? Networks.PUBLIC : Networks.TESTNET;

const horizon = new Horizon.Server(HORIZON_URL);
const soroban = new rpc.Server(SOROBAN_URL, { allowHttp: false });

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

export async function getAccountBalance(
  publicKey: string,
): Promise<Array<Horizon.HorizonApi.BalanceLine>> {
  const account = await horizon.loadAccount(publicKey);
  return account.balances;
}

// ── Classic Stellar payments ──────────────────────────────────────────────────

export async function sendPayment(
  sourceSecret: string,
  destinationPublic: string,
  amount: string,
  assetCode: string = 'XLM',
  assetIssuer?: string,
  memoHash?: Buffer,
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
    builder.addMemo(Memo.hash(memoHash));
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

export async function pathPaymentStrictSend(
  sourceSecret: string,
  destinationPublic: string,
  sendAsset: Asset,
  sendAmount: string,
  destAsset: Asset,
  memoHash?: Buffer,
): Promise<string> {
  const sourceKeypair = Keypair.fromSecret(sourceSecret);
  logger.info('Preparing path payment', {
    from: sourceKeypair.publicKey(),
    to: destinationPublic,
    sendAmount,
    sendAssetCode: sendAsset.code || 'XLM',
    destAssetCode: destAsset.code || 'XLM',
  });

  const account = await horizon.loadAccount(sourceKeypair.publicKey());
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
        destMin: '0',
        path: [],
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

export async function addTrustline(
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
      Operation.changeTrust({ asset: new Asset(assetCode, assetIssuer), limit: '1000000' }),
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

// ── Soroban SmartWallet deployment ────────────────────────────────────────────

async function pollSorobanTx(txHash: string): Promise<rpc.Api.GetTransactionResponse> {
  // Poll up to 60 times with 3-second intervals = 180 seconds max wait
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const result = await soroban.getTransaction(txHash);
    if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return result;
  }
  throw new Error(`Soroban transaction ${txHash} was not confirmed within 180 s`);
}

async function buildAndSubmitSoroban(
  keypair: Keypair,
  op: ReturnType<typeof Operation.uploadContractWasm>,
  retries = 3,
): Promise<rpc.Api.GetTransactionResponse> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const account = await soroban.getAccount(keypair.publicKey());

      const tx = new TransactionBuilder(account, {
        fee: String(Number(BASE_FEE) * 100),
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(op)
        .setTimeout(60)
        .build();

      const prepared = await soroban.prepareTransaction(tx);
      prepared.sign(keypair);

      const result = await soroban.sendTransaction(prepared);
      if (result.status === 'ERROR') {
        const errorMsg = JSON.stringify(result.errorResult);
        // Retry on sequence number errors
        if (errorMsg.includes('txBadSeq') && attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
          continue;
        }
        throw new Error(`Soroban submit error: ${errorMsg}`);
      }
      return pollSorobanTx(result.hash);
    } catch (err) {
      if (attempt === retries - 1) throw err;
      // Exponential backoff before retry
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Deploys a Funti3r SmartWallet Soroban contract for a worker.
 *
 * @param passkeyPkHex  Hex-encoded 65-byte uncompressed P-256 public key.
 * @param credentialIdHex  Hex-encoded WebAuthn credential ID bytes.
 * @returns The Soroban contract address (Stellar StrKey).
 */
export async function deploySmartWallet(
  passkeyPkHex: string,
  credentialIdHex: string,
): Promise<string> {
  const operatorSecret = process.env.STELLAR_OPERATOR_SECRET;
  if (!operatorSecret) {
    throw new Error('STELLAR_OPERATOR_SECRET is required to deploy SmartWallet contracts');
  }

  // Navigate from services/payment-service/src/lib to project root
  const wasmPath = join(
    __dirname,
    '../../../../contracts/target/wasm32-unknown-unknown/release/funti3r_soroban.wasm',
  );

  let wasmBytes: Buffer;
  try {
    wasmBytes = readFileSync(wasmPath);
  } catch {
    throw new Error(
      `SmartWallet WASM not found at ${wasmPath}. ` +
      'Run: cd contracts && cargo build --target wasm32-unknown-unknown --release',
    );
  }

  const keypair = Keypair.fromSecret(operatorSecret);
  const salt = randomBytes(32);
  const wasmHash = hash(wasmBytes);

  // 1. Upload WASM (idempotent on-chain — same hash is a no-op if already uploaded)
  logger.info('Uploading SmartWallet WASM', { wasmHash: wasmHash.toString('hex') });
  const uploadResult = await buildAndSubmitSoroban(
    keypair,
    Operation.uploadContractWasm({ wasm: wasmBytes }),
  );
  if (uploadResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`WASM upload failed: ${uploadResult.status}`);
  }

  // 2. Create contract instance
  logger.info('Creating SmartWallet contract instance');
  const createResult = await buildAndSubmitSoroban(
    keypair,
    Operation.createCustomContract({
      address: new Address(keypair.publicKey()),
      wasmHash,
      salt,
    }),
  );
  if (createResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Contract creation failed: ${createResult.status}`);
  }

  const contractAddress = Address.fromScVal(createResult.returnValue!).toString();

  // Wait for contract to be fully initialized on chain before calling init
  await new Promise(r => setTimeout(r, 2000));

  // 3. Initialise the contract with the worker's passkey
  logger.info('Initialising SmartWallet contract', { contractAddress });
  const contract = new Contract(contractAddress);
  const initResult = await buildAndSubmitSoroban(
    keypair,
    contract.call(
      'init',
      nativeToScVal(new Address(contractAddress), { type: 'address' }),
      nativeToScVal(Buffer.from(credentialIdHex, 'hex'), { type: 'bytes' }),
      nativeToScVal(Buffer.from(passkeyPkHex, 'hex'), { type: 'bytes' }),
    ),
  );
  if (initResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Contract init failed: ${initResult.status}`);
  }

  logger.info('SmartWallet deployed', { contractAddress });
  return contractAddress;
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
 */
export async function prepareUnsignedPathPayment(
  sourcePublic: string,
  destinationPublic: string,
  sendAsset: Asset,
  sendAmount: string,
  destAsset: Asset,
  memoHash?: Buffer,
): Promise<string> {
  logger.info('Preparing unsigned path payment', {
    from: sourcePublic,
    to: destinationPublic,
    sendAmount,
    sendAssetCode: sendAsset.code || 'XLM',
    destAssetCode: destAsset.code || 'XLM',
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
        destMin: '0',
        path: [],
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
    // Parse the XDR to get the transaction
    const tx = new (require('@stellar/stellar-sdk')).TransactionBuilder.fromXDR(signedXDR, NETWORK_PASSPHRASE);

    logger.info('Submitting externally-signed transaction');
    const result = await horizon.submitTransaction(tx);
    logger.info('Externally-signed transaction submitted', { hash: result.hash });
    return result.hash;
  } catch (err) {
    logger.error('Failed to submit externally-signed transaction', { error: String(err) });
    throw err;
  }
}

// ── Horizon streaming ─────────────────────────────────────────────────────────

export async function streamEnterprisePayments(
  enterprisePublicKey: string,
  onPayment: (hash: string) => Promise<void>,
): Promise<() => void> {
  const redis = await getRedis();
  const cursorKey = `stellar:cursor:${enterprisePublicKey}`;

  let cursor: string | null = null;
  try {
    cursor = await redis.get(cursorKey);
  } catch (err) {
    logger.warn('Failed to load cursor from Redis', { error: String(err) });
  }

  logger.info('Starting Horizon payment stream', { enterprisePublicKey, cursor });

  const stream = horizon
    .payments()
    .forAccount(enterprisePublicKey)
    .cursor(cursor ?? 'now')
    .stream({
      onmessage: async (
        op: Horizon.ServerApi.OperationRecord,
      ) => {
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

        // Persist cursor for recovery
        if ('paging_token' in op && op.paging_token) {
          try {
            await redis.set(cursorKey, op.paging_token, { EX: 86400 * 7 });
          } catch (err) {
            logger.warn('Failed to persist cursor', { error: String(err) });
          }
        }
      },
      onerror: (err: unknown) => {
        logger.error('Horizon stream error', { error: String(err) });
      },
    });

  return () => {
    // Stream returned from Horizon is an event emitter with close ability
    if (stream && typeof stream === 'object' && 'close' in stream) {
      (stream as any).close();
    }
  };
}
