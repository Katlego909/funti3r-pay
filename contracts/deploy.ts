/**
 * Soroban SmartWallet deployment script.
 *
 * Usage:
 *   pnpm tsx contracts/deploy.ts \
 *     --owner <stellar-address> \
 *     --passkey-pk <hex-65-bytes>  \
 *     --credential-id <hex-bytes>
 *
 * Prerequisites:
 *   1. `cargo build --target wasm32-unknown-unknown --release` from /contracts
 *   2. STELLAR_OPERATOR_SECRET env var (funded testnet account)
 *   3. STELLAR_SOROBAN_URL env var (default: https://soroban-testnet.stellar.org)
 */

import {
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
  Address,
  Operation,
  hash,
  nativeToScVal,
  Contract,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';

const WASM_PATH = join(
  import.meta.dirname,
  'target/wasm32-unknown-unknown/release/funti3r_soroban.wasm',
);

const SOROBAN_URL =
  process.env.STELLAR_SOROBAN_URL || 'https://soroban-testnet.stellar.org';

const server = new rpc.Server(SOROBAN_URL, { allowHttp: false });

async function pollTransaction(txHash: string): Promise<rpc.Api.GetTransactionResponse> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await server.getTransaction(txHash);
    if (status.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return status;
  }
  throw new Error(`Transaction ${txHash} not confirmed after 60s`);
}

async function buildAndSubmit(
  keypair: Keypair,
  operation: ReturnType<typeof Operation.uploadContractWasm>,
): Promise<rpc.Api.GetTransactionResponse> {
  const account = await server.getAccount(keypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 100),
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  const result = await server.sendTransaction(prepared);
  if (result.status === 'ERROR') {
    throw new Error(`Submit failed: ${JSON.stringify(result.errorResult)}`);
  }
  return pollTransaction(result.hash);
}

async function deploy(options: {
  ownerAddress: string;
  credentialId: Buffer;
  passkeyPk: Buffer;
}): Promise<string> {
  const operatorSecret = process.env.STELLAR_OPERATOR_SECRET;
  if (!operatorSecret) throw new Error('STELLAR_OPERATOR_SECRET is required');

  const keypair = Keypair.fromSecret(operatorSecret);
  const wasmBytes = readFileSync(WASM_PATH);
  const salt = randomBytes(32);
  const wasmHash = hash(wasmBytes);

  // 1. Upload WASM
  console.log('Uploading WASM...');
  const uploadResult = await buildAndSubmit(
    keypair,
    Operation.uploadContractWasm({ wasm: wasmBytes }),
  );
  if (uploadResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`WASM upload failed: ${uploadResult.status}`);
  }
  console.log(`WASM hash: ${wasmHash.toString('hex')}`);

  // 2. Create contract instance
  console.log('Creating contract instance...');
  const createResult = await buildAndSubmit(
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
  console.log(`Contract address: ${contractAddress}`);

  // 3. Initialise
  console.log('Calling contract init...');
  const contract = new Contract(contractAddress);
  const initResult = await buildAndSubmit(
    keypair,
    contract.call(
      'init',
      nativeToScVal(new Address(options.ownerAddress), { type: 'address' }),
      nativeToScVal(options.credentialId, { type: 'bytes' }),
      nativeToScVal(options.passkeyPk, { type: 'bytes' }),
    ),
  );
  if (initResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Contract init failed: ${initResult.status}`);
  }
  console.log('Contract initialised successfully.');

  return contractAddress;
}

// CLI entry-point
if (process.argv.includes('--owner')) {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const ownerAddress = get('--owner');
  const passkeyPkHex = get('--passkey-pk');
  const credentialIdHex = get('--credential-id');

  if (!ownerAddress || !passkeyPkHex || !credentialIdHex) {
    console.error('Usage: tsx deploy.ts --owner <addr> --passkey-pk <hex> --credential-id <hex>');
    process.exit(1);
  }

  deploy({
    ownerAddress,
    passkeyPk: Buffer.from(passkeyPkHex, 'hex'),
    credentialId: Buffer.from(credentialIdHex, 'hex'),
  })
    .then((addr) => { console.log(`\nDeployed SmartWallet: ${addr}`); process.exit(0); })
    .catch((err) => { console.error(err); process.exit(1); });
}

export { deploy };
