import { vi } from 'vitest';

// Env vars read at module load time by src/lib/currencies.ts — must be set
// before any test file's first import of app.ts. Fake but well-formed-looking
// Stellar public keys; never used for a real network call (Stellar I/O itself
// is mocked via ../lib/stellar.js below).
process.env.STELLAR_USDC_ISSUER = 'GAUSDCTESTISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
process.env.STELLAR_AFRICA_ISSUER = 'GAAFRICATESTISSUERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
process.env.COMPLIANCE_SERVICE_URL = 'http://compliance.test';

vi.mock('@funti3r/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@funti3r/database')>();
  return { ...actual, query: vi.fn() };
});

vi.mock('axios');

// executePayout's orchestration logic is the unit under test — not Horizon's
// wire protocol. Mocking lib/stellar.ts wholesale is the correct boundary
// (it's also what avoids fighting the module's own load-time Horizon.Server
// singleton construction).
// The anchor rail's SEP wire protocol is exercised by scripts/anchor-e2e.ts
// on testnet; here only the routing decision is under test.
vi.mock('../rails/anchor.js', () => ({
  anchorConfigured: vi.fn(() => true),
  sendAnchorPayout: vi.fn(),
}));

// Same boundary as lib/stellar.js — escrow routes orchestrate, the Soroban
// wire protocol itself is exercised by scripts/escrow-e2e.ts on testnet.
vi.mock('../lib/escrow.js', () => ({
  createEscrow: vi.fn(),
  approveMilestone: vi.fn(),
  claimMilestone: vi.fn(),
  refundEscrow: vi.fn(),
  getEscrow: vi.fn(),
  nativeTokenAddress: vi.fn(),
  xlmToStroops: vi.fn(),
}));

vi.mock('../lib/stellar.js', () => ({
  sendPayment: vi.fn(),
  ensureTrustline: vi.fn(),
  payExactWithXlm: vi.fn(),
  createClaimableBalance: vi.fn(),
  getAccountBalance: vi.fn(),
  createKeypair: vi.fn(),
  fundWithFriendbot: vi.fn(),
  submitSignedTransaction: vi.fn(),
  streamEnterprisePayments: vi.fn(),
}));
