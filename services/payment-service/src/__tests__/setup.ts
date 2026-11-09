import { vi } from 'vitest';

// vi.mock factories are hoisted above imports; this makes the real AppError reachable from them.
const { AppError } = await vi.hoisted(() => import('@funti3r/shared-utils'));

// Env vars read at module load time by src/lib/currencies.ts — must be set
// before any test file's first import of app.ts. Fake but well-formed-looking
// Stellar public keys; never used for a real network call (Stellar I/O itself
// is mocked via ../lib/stellar.js below).
process.env.STELLAR_USDC_ISSUER = 'GAUSDCTESTISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
process.env.STELLAR_AFRICA_ISSUER = 'GAAFRICATESTISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
process.env.COMPLIANCE_SERVICE_URL = 'http://compliance.test';

vi.mock('@funti3r/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@funti3r/database')>();
  // No Redis in unit tests: the shared caches (FX prices) fall back to process memory instead of a real server.
  const noRedis = () => Promise.reject(new Error('Redis is not available in unit tests'));
  return { ...actual, query: vi.fn(), getJSON: vi.fn(noRedis), setJSON: vi.fn(noRedis) };
});

vi.mock('axios');

// executePayout's orchestration logic is the unit under test — not Horizon's
// wire protocol. Mocking lib/stellar.ts wholesale is the correct boundary
// (it's also what avoids fighting the module's own load-time Horizon.Server
// singleton construction).
// Same boundary as lib/stellar.js — escrow routes orchestrate, the Soroban
// wire protocol itself is exercised by scripts/escrow-e2e.ts on testnet.
vi.mock('../lib/escrow.js', () => ({
  setFrozen: vi.fn(),
  returnFrozen: vi.fn(),
  isCleared: vi.fn(),
  getClearance: vi.fn(),
  complianceAuthorityPublic: vi.fn(() => 'GCOMPLIANCEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'),
  setClearance: vi.fn(),
  revokeClearance: vi.fn(),
  attestationHash: vi.fn(),
  createEscrow: vi.fn(),
  approveMilestone: vi.fn(),
  claimMilestone: vi.fn(),
  refundEscrow: vi.fn(),
  getEscrow: vi.fn(),
  nativeTokenAddress: vi.fn(),
  xlmToStroops: vi.fn(),
  // The error handler maps failures by their AppError status, so the class must be real.
  EscrowContractError: class EscrowContractError extends AppError {
    constructor(public readonly contractCode: number, public readonly method: string) {
      const block = contractCode === 11 || contractCode === 12;
      super(block ? 403 : 409, `contract error #${contractCode}`, block ? 'compliance_blocked' : 'contract_rejected', { contractCode });
    }
  },
}));

// On-chain clearance sync: the real module talks to the compliance service
// and the contract; routes only care whether it resolves or blocks.
vi.mock('../lib/clearance.js', () => ({
  ensureCleared: vi.fn().mockResolvedValue({ cleared: true }),
  screenEmployer: vi.fn().mockResolvedValue(undefined),
  ComplianceBlockedError: class ComplianceBlockedError extends AppError {
    constructor(message: string) { super(403, message, 'compliance_blocked'); }
  },
}));

vi.mock('../lib/stellar.js', () => ({
  sendPayment: vi.fn(),
  findTransactionByMemoHash: vi.fn(),
  lookupTransaction: vi.fn(),
  HorizonRejectedError: class HorizonRejectedError extends AppError {
    constructor(readonly resultCodes: { transaction?: string; operations?: string[] }, cause: unknown) {
      super(502, 'The Stellar network rejected the transaction', resultCodes.operations?.[0] ?? 'horizon_rejected');
      this.cause = cause;
    }
  },
  SubmitOutcomeUnknownError: class SubmitOutcomeUnknownError extends Error {
    constructor(readonly txHash: string, cause?: unknown) { super(`Submission outcome unknown for ${txHash}`, { cause }); }
  },
  ensureTrustline: vi.fn(),
  payExactWithXlm: vi.fn(),
  spendableXlm: vi.fn(),
  createClaimableBalance: vi.fn(),
  getAccountBalance: vi.fn(),
  payoutOutcome: vi.fn(),
}));
