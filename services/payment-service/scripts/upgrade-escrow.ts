/**
 * Upgrades the deployed funti3r-escrow contract in place: uploads the freshly built wasm and
 * calls the admin-only `upgrade(new_wasm_hash)`. The contract address and every stored escrow
 * and clearance survive, so ESCROW_CONTRACT_ADDRESS does not change.
 *
 * Prereqs: build the wasm first (`stellar contract build --package funti3r-escrow` in contracts/),
 * STELLAR_OPERATOR_SECRET (the contract admin) and ESCROW_CONTRACT_ADDRESS in .env.local.
 *
 * Run: node --env-file=../../.env.local --import tsx scripts/upgrade-escrow.ts
 */
import {
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const WASM_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../contracts/target/wasm32v1-none/release/funti3r_escrow.wasm',
);

const server = new rpc.Server(process.env.STELLAR_SOROBAN_URL || 'https://soroban-testnet.stellar.org');

async function submit(keypair: Keypair, operation: ReturnType<typeof Operation.uploadContractWasm>) {
  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: String(Number(BASE_FEE) * 100), networkPassphrase: Networks.TESTNET })
    .addOperation(operation)
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(`Submit failed: ${JSON.stringify(sent.errorResult)}`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await server.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return sent.hash;
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`Transaction ${sent.hash} failed`);
  }
  throw new Error(`Transaction ${sent.hash} not confirmed after 60s`);
}

async function main() {
  const adminSecret = process.env.STELLAR_OPERATOR_SECRET;
  const contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
  if (!adminSecret) throw new Error('STELLAR_OPERATOR_SECRET is required');
  if (!contractAddress) throw new Error('ESCROW_CONTRACT_ADDRESS is required');
  const admin = Keypair.fromSecret(adminSecret);

  const wasm = readFileSync(WASM_PATH);
  const wasmHash = hash(wasm);
  console.log(`Uploading ${wasm.length} bytes, sha256 of wasm: ${wasmHash.toString('hex')}`);
  const uploadTx = await submit(admin, Operation.uploadContractWasm({ wasm }));
  console.log(`upload tx:  ${uploadTx}`);

  const upgradeTx = await submit(
    admin,
    Operation.invokeContractFunction({
      contract: contractAddress,
      function: 'upgrade',
      args: [nativeToScVal(wasmHash, { type: 'bytes' })],
    }),
  );
  console.log(`upgrade tx: ${upgradeTx}`);
  console.log(`https://stellar.expert/explorer/testnet/contract/${contractAddress}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
