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
} from '@stellar/stellar-sdk';
import { createLogger } from '@funti3r/shared-utils';
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

export async function getAccountBalance(publicKey: string): Promise<Horizon.HorizonApi.BalanceLineType[]> {
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

  const tx = new TransactionBuilder(account, {
    fee: String(Math.max(fee, 100)),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination: destinationPublic, asset, amount }))
    .setTimeout(60)
    .build();

  tx.sign(sourceKeypair);
  const result = await horizon.submitTransaction(tx);
  logger.info('Payment submitted', { hash: result.hash });
  return result.hash;
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
    fee: String(Math.max(fee, 100)),
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
): Promise<rpc.Api.GetTransactionResponse> {
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
    throw new Error(`Soroban submit error: ${JSON.stringify(result.errorResult)}`);
  }
  return pollSorobanTx(result.hash);
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
