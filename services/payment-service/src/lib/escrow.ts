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
  xdr,
} from '@stellar/stellar-sdk';
import { createHash } from 'node:crypto';
import { createLogger } from '@funti3r/shared-utils';
import { withAdvisoryLock } from '@funti3r/database';

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

/** Mirror of the contract's `Error` enum (contracts/escrow/src/lib.rs). */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: 'Escrow not found',
  2: 'An escrow needs at least one milestone',
  3: 'Invalid milestone amount',
  4: 'Expiry must be in the future',
  5: 'Escrow is no longer active',
  6: 'Milestone does not exist',
  7: 'Milestone is not pending',
  8: 'Milestone is not approved',
  9: 'Escrow has not expired yet',
  10: 'Nothing to refund',
  11: 'Worker is not compliance-cleared',
  12: 'Escrow is frozen by compliance',
  13: 'Clearance expiry must be in the future',
};

/** A rejection by the escrow contract itself, with its numeric error code. */
export class EscrowContractError extends Error {
  constructor(public readonly code: number, public readonly method: string) {
    super(CONTRACT_ERRORS[code] ?? `Escrow contract error #${code}`);
    this.name = 'EscrowContractError';
  }
  /** True when the compliance gate (not a business rule) rejected the call. */
  get isComplianceBlock(): boolean {
    return this.code === 11 || this.code === 12;
  }
}

/** Soroban surfaces contract errors as "Error(Contract, #N)" in sim/result text. */
function contractErrorCode(text: string): number | undefined {
  const m = /Error\(Contract, #(\d+)\)/.exec(text);
  return m ? Number(m[1]) : undefined;
}

/** Simulate, assemble, sign as `signer` (also the source account), submit, poll. */
async function invokeUnlocked(
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

  let prepared;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (err) {
    // Simulation runs the contract, so a gate rejection surfaces here.
    const code = contractErrorCode(String(err instanceof Error ? err.message : err));
    if (code !== undefined) throw new EscrowContractError(code, method);
    throw err;
  }
  prepared.sign(signer);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`Escrow ${method} submit failed: ${JSON.stringify(sent.errorResult)}`);
  }
  const result = await pollTransaction(sent.hash);
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    const code = contractErrorCode(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    if (code !== undefined) throw new EscrowContractError(code, method);
    throw new Error(`Escrow ${method} failed on-chain: ${result.status}`);
  }
  const returnValue =
    'returnValue' in result && result.returnValue ? scValToNative(result.returnValue) : undefined;
  logger.info('Escrow contract call succeeded', { method, hash: sent.hash });
  return { hash: sent.hash, returnValue };
}

function complianceSecret(): string {
  const secret = process.env.ESCROW_COMPLIANCE_SECRET;
  if (!secret) throw new Error('ESCROW_COMPLIANCE_SECRET is not configured');
  return secret;
}

/** Public key of the compliance authority (the contract's `compliance` role). */
/**
 * Contract calls from one account must not overlap either (each uses the account's next sequence number): the
 * compliance key clears several workers at once, an enterprise approves while a refund is in flight. Serialized per
 * signing account across the whole cluster, and held until the call is confirmed so the next one sees the new sequence.
 */
function invoke(
  signerSecret: string,
  method: string,
  args: ReturnType<typeof nativeToScVal>[],
): Promise<{ hash: string; returnValue: unknown }> {
  return withAdvisoryLock(`stellar:${Keypair.fromSecret(signerSecret).publicKey()}`, () => invokeUnlocked(signerSecret, method, args));
}

export function complianceAuthorityPublic(): string {
  return Keypair.fromSecret(complianceSecret()).publicKey();
}

/** 32-byte hash binding an on-chain clearance to the off-chain screening record. */
export function attestationHash(record: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(record)).digest();
}

/** Compliance authority clears `workerPublic` until `expiryUnix`. */
export async function setClearance(
  workerPublic: string,
  expiryUnix: number,
  attestation: Buffer,
): Promise<string> {
  const { hash } = await invoke(complianceSecret(), 'set_clearance', [
    nativeToScVal(new Address(workerPublic), { type: 'address' }),
    nativeToScVal(BigInt(expiryUnix), { type: 'u64' }),
    nativeToScVal(attestation, { type: 'bytes' }),
  ]);
  return hash;
}

/** Compliance authority immediately removes a worker's clearance. */
export async function revokeClearance(workerPublic: string): Promise<string> {
  const { hash } = await invoke(complianceSecret(), 'revoke_clearance', [
    nativeToScVal(new Address(workerPublic), { type: 'address' }),
  ]);
  return hash;
}

/** Compliance hold on / release of a single escrow. */
export async function setFrozen(escrowId: bigint, frozen: boolean): Promise<string> {
  const { hash } = await invoke(complianceSecret(), 'set_frozen', [
    nativeToScVal(escrowId, { type: 'u64' }),
    xdr.ScVal.scvBool(frozen),
  ]);
  return hash;
}

/** Read-only: does the worker hold a live on-chain clearance? */
export async function isCleared(workerPublic: string): Promise<boolean> {
  const sourcePublic = complianceAuthorityPublic();
  const account = await server.getAccount(sourcePublic);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(contractAddress()).call(
        'is_cleared',
        nativeToScVal(new Address(workerPublic), { type: 'address' }),
      ),
    )
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) {
    throw new Error('is_cleared simulation failed');
  }
  return scValToNative(sim.result.retval) === true;
}

export interface OnchainEscrow {
  enterprise: string;
  worker: string;
  token: string;
  amounts: bigint[];
  milestones: string[]; // 'Pending' | 'Approved' | 'Claimed' | 'Refunded'
  expiry: bigint;
  status: string; // 'Active' | 'Completed' | 'Refunded'
  frozen: boolean;
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
    frozen: raw.frozen === true,
  };
}
