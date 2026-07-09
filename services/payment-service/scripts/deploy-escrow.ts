/**
 * Deploys the funti3r-escrow contract to testnet.
 *
 * Prereqs:
 *   1. cd contracts && cargo build --target wasm32v1-none --release -p funti3r-escrow
 *      (wasm32v1-none, NOT wasm32-unknown-unknown — modern rustc emits
 *      post-MVP WASM features there that the Soroban VM rejects)
 *   2. STELLAR_OPERATOR_SECRET in .env.local (funded testnet account)
 *
 * Run: node --env-file=../../.env.local --import tsx scripts/deploy-escrow.ts
 * Then add the printed ESCROW_CONTRACT_ADDRESS to .env.local.
 */
import {
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
  rpc,
} from '@stellar/stellar-sdk';
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const WASM_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../contracts/target/wasm32v1-none/release/funti3r_escrow.wasm',
);

const SOROBAN_URL = process.env.STELLAR_SOROBAN_URL || 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(SOROBAN_URL);

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

async function main() {
  const operatorSecret = process.env.STELLAR_OPERATOR_SECRET;
  if (!operatorSecret) throw new Error('STELLAR_OPERATOR_SECRET is required');
  const keypair = Keypair.fromSecret(operatorSecret);
  const wasmBytes = readFileSync(WASM_PATH);
  const wasmHash = hash(wasmBytes);

  console.log(`Uploading funti3r_escrow.wasm (${wasmBytes.length} bytes)...`);
  const upload = await buildAndSubmit(keypair, Operation.uploadContractWasm({ wasm: wasmBytes }));
  if (upload.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`WASM upload failed: ${upload.status}`);
  }
  console.log(`WASM hash: ${wasmHash.toString('hex')}`);
  console.log(`Upload tx: ${upload.txHash}`);

  console.log('Creating contract instance...');
  const create = await buildAndSubmit(
    keypair,
    Operation.createCustomContract({
      address: new Address(keypair.publicKey()),
      wasmHash,
      salt: randomBytes(32),
    }),
  );
  if (create.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Contract creation failed: ${create.status}`);
  }
  const contractAddress = Address.fromScVal(create.returnValue!).toString();

  console.log('\n── Escrow contract deployed ──────────────────────────────');
  console.log(`Contract address : ${contractAddress}`);
  console.log(`Deploy tx        : ${create.txHash}`);
  console.log(`Explorer         : https://stellar.expert/explorer/testnet/contract/${contractAddress}`);
  console.log('\nAdd to .env.local:');
  console.log(`ESCROW_CONTRACT_ADDRESS=${contractAddress}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
