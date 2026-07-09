/**
 * Invocation layer for the funti3r-escrow Soroban contract (contracts/escrow).
 *
 * Auth model: every entrypoint requires the acting party's auth; we make that
 * party the transaction source account, so signing the envelope satisfies
 * require_auth via source-account credentials — no separate auth entries.
 *
 * Amounts are XLM decimals at this boundary and stroops (i128) on-chain.
 */
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from '@stellar/stellar-sdk';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('EscrowService');

const SOROBAN_URL = process.env.STELLAR_SOROBAN_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === 'MAINNET' ? Networks.PUBLIC : Networks.TESTNET;

const server = new rpc.Server(SOROBAN_URL);

function contractAddress(): string {
  const addr = process.env.ESCROW_CONTRACT_ADDRESS;
  if (!addr) throw new Error('ESCROW_CONTRACT_ADDRESS is not configured — run scripts/deploy-escrow.ts');
  return addr;
}

/** The Stellar Asset Contract address for native XLM on the current network. */
export function nativeTokenAddress(): string {
  return Asset.native().contractId(NETWORK_PASSPHRASE);
}

export function xlmToStroops(amountXlm: string | number): bigint {
  // Fixed-point via string math — no float drift on 7-decimal amounts.
  const [whole, frac = ''] = String(amountXlm).split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > 7) {
    throw new Error(`Invalid XLM amount: ${amountXlm}`);
  }
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, '0') || '0');
}

async function pollTransaction(txHash: string): Promise<rpc.Api.GetTransactionResponse> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await server.getTransaction(txHash);
    if (status.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return status;
  }
  throw new Error(`Transaction ${txHash} not confirmed after 60s`);
}

/** Simulate, assemble, sign as `signer` (also the source account), submit, poll. */
async function invoke(
  signerSecret: string,
  method: string,
  args: ReturnType<typeof nativeToScVal>[],
): Promise<{ hash: string; returnValue: unknown }> {
  const signer = Keypair.fromSecret(signerSecret);
  const account = await server.getAccount(signer.publicKey());
  const contract = new Contract(contractAddress());

  const tx = new TransactionBuilder(account, {
    fee: String(Number(BASE_FEE) * 100),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signer);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`Escrow ${method} submit failed: ${JSON.stringify(sent.errorResult)}`);
  }
  const result = await pollTransaction(sent.hash);
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Escrow ${method} failed on-chain: ${result.status}`);
  }
  const returnValue =
    'returnValue' in result && result.returnValue ? scValToNative(result.returnValue) : undefined;
  logger.info('Escrow contract call succeeded', { method, hash: sent.hash });
  return { hash: sent.hash, returnValue };
}

export interface OnchainEscrow {
  enterprise: string;
  worker: string;
  token: string;
  amounts: bigint[];
  milestones: string[]; // 'Pending' | 'Approved' | 'Claimed' | 'Refunded'
  expiry: bigint;
  status: string; // 'Active' | 'Completed' | 'Refunded'
}

/** Enterprise funds a new escrow; returns the on-chain escrow id + tx hash. */
export async function createEscrow(
  enterpriseSecret: string,
  workerPublic: string,
  amountsXlm: Array<string | number>,
  expiryUnix: number,
): Promise<{ escrowId: bigint; hash: string }> {
  const enterprise = Keypair.fromSecret(enterpriseSecret).publicKey();
  const { hash, returnValue } = await invoke(enterpriseSecret, 'create', [
    nativeToScVal(new Address(enterprise), { type: 'address' }),
    nativeToScVal(new Address(workerPublic), { type: 'address' }),
    nativeToScVal(new Address(nativeTokenAddress()), { type: 'address' }),
    nativeToScVal(amountsXlm.map(xlmToStroops), { type: 'i128' }),
    nativeToScVal(BigInt(expiryUnix), { type: 'u64' }),
  ]);
  return { escrowId: returnValue as bigint, hash };
}

export async function approveMilestone(
  enterpriseSecret: string,
  escrowId: bigint,
  idx: number,
): Promise<string> {
  const { hash } = await invoke(enterpriseSecret, 'approve', [
    nativeToScVal(escrowId, { type: 'u64' }),
    nativeToScVal(idx, { type: 'u32' }),
  ]);
  return hash;
}

export async function claimMilestone(
  workerSecret: string,
  escrowId: bigint,
  idx: number,
): Promise<string> {
  const { hash } = await invoke(workerSecret, 'claim', [
    nativeToScVal(escrowId, { type: 'u64' }),
    nativeToScVal(idx, { type: 'u32' }),
  ]);
  return hash;
}

/** Refund all still-pending tranches after expiry; returns stroops refunded + hash. */
export async function refundEscrow(
  enterpriseSecret: string,
  escrowId: bigint,
): Promise<{ refundedStroops: bigint; hash: string }> {
  const { hash, returnValue } = await invoke(enterpriseSecret, 'refund', [
    nativeToScVal(escrowId, { type: 'u64' }),
  ]);
  return { refundedStroops: returnValue as bigint, hash };
}

/** Read-only view via simulation — no transaction submitted, no fee. */
export async function getEscrow(escrowId: bigint, sourcePublic: string): Promise<OnchainEscrow> {
  const account = await server.getAccount(sourcePublic);
  const contract = new Contract(contractAddress());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call('get_escrow', nativeToScVal(escrowId, { type: 'u64' })))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    throw new Error(`get_escrow simulation failed for id ${escrowId}`);
  }
  const raw = scValToNative(sim.result.retval);
  return {
    enterprise: raw.enterprise,
    worker: raw.worker,
    token: raw.token,
    amounts: raw.amounts,
    milestones: raw.milestones.map((m: unknown) => String(Array.isArray(m) ? m[0] : m)),
    expiry: raw.expiry,
    status: String(Array.isArray(raw.status) ? raw.status[0] : raw.status),
  };
}
