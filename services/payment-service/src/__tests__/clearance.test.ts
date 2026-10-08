import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as escrow from '../lib/escrow.js';

// setup.ts replaces lib/clearance.js for the route tests; here the real module
// is the unit under test, with the chain calls (lib/escrow.js) mocked.
const { ensureCleared, screenEmployer, ComplianceBlockedError } =
  await vi.importActual<typeof import('../lib/clearance.js')>('../lib/clearance.js');

const WORKER_ID = 'worker-1111-1111-1111-111111111111';
const WORKER_PUB = 'GDESTWORKERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const verified = {
  status: 'verified',
  basis: 'reviewed',
  verified_at: '2026-10-01T00:00:00Z',
  sanctions_status: 'clear',
  sanctions_checked_at: '2026-10-01T00:00:00Z',
};

const isCleared = vi.mocked(escrow.isCleared);
const setClearance = vi.mocked(escrow.setClearance);
const revokeClearance = vi.mocked(escrow.revokeClearance);
const attestationHash = vi.mocked(escrow.attestationHash);

beforeEach(() => {
  isCleared.mockReset();
  setClearance.mockReset().mockResolvedValue('tx-clear');
  revokeClearance.mockReset().mockResolvedValue('tx-revoke');
  attestationHash.mockReset().mockReturnValue(Buffer.alloc(32, 1));
  vi.mocked(axios.get).mockReset();
});

describe('ensureCleared', () => {
  it('clears a verified, sanctions-clear worker who has no on-chain clearance, binding the screening record', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: verified });
    isCleared.mockResolvedValue(false);

    const out = await ensureCleared(WORKER_ID, WORKER_PUB);

    expect(out).toEqual({ cleared: true, txHash: 'tx-clear' });
    expect(setClearance).toHaveBeenCalledWith(WORKER_PUB, expect.any(Number), expect.any(Buffer));
    // The attestation covers the screening verdict, not just the worker id.
    expect(attestationHash).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: WORKER_ID, sanctions_status: 'clear', sanctions_checked_at: verified.sanctions_checked_at, basis: 'reviewed' }),
    );
  });

  it('does not spend a transaction when the worker is already cleared on-chain', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: verified });
    isCleared.mockResolvedValue(true);

    expect(await ensureCleared(WORKER_ID, WORKER_PUB)).toEqual({ cleared: true });
    expect(setClearance).not.toHaveBeenCalled();
    expect(revokeClearance).not.toHaveBeenCalled();
  });

  it('revokes a live on-chain clearance and blocks when the worker has been sanctions-flagged', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { ...verified, status: 'rejected', sanctions_status: 'flagged' } });
    isCleared.mockResolvedValue(true);

    await expect(ensureCleared(WORKER_ID, WORKER_PUB)).rejects.toThrow(/sanctions match/);
    expect(revokeClearance).toHaveBeenCalledWith(WORKER_PUB);
    expect(setClearance).not.toHaveBeenCalled();
  });

  it('blocks an unverified worker without a revoke transaction when nothing was cleared', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { status: 'pending' } });
    isCleared.mockResolvedValue(false);

    await expect(ensureCleared(WORKER_ID, WORKER_PUB)).rejects.toThrow(/KYC not verified/);
    expect(revokeClearance).not.toHaveBeenCalled();
  });

  it('a sanctions flag wins even if the KYC status still reads verified', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { ...verified, sanctions_status: 'flagged' } });
    isCleared.mockResolvedValue(false);

    await expect(ensureCleared(WORKER_ID, WORKER_PUB)).rejects.toBeInstanceOf(ComplianceBlockedError);
    expect(setClearance).not.toHaveBeenCalled();
  });

  it('fails closed when the compliance service is unreachable', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(ensureCleared(WORKER_ID, WORKER_PUB)).rejects.toThrow(/Compliance service unavailable/);
    expect(setClearance).not.toHaveBeenCalled();
  });
});

describe('screenEmployer', () => {
  const OWNER_ID = 'owner-1111-1111-1111-111111111111';
  const company = (row: Record<string, unknown> = { company_name: 'Acme Logistics', first_name: 'Thandi', last_name: 'Nkosi' }) =>
    vi.mocked(query).mockResolvedValue({ rows: [row] } as never);

  beforeEach(() => {
    vi.mocked(axios.post).mockReset();
  });

  it('screens the company name and the owner, and passes a clean company', async () => {
    company();
    vi.mocked(axios.post).mockResolvedValue({ data: { matches: [] } });

    await expect(screenEmployer(OWNER_ID)).resolves.toBeUndefined();
    expect(vi.mocked(axios.post).mock.calls[0][1]).toEqual({ names: ['Acme Logistics', 'Thandi Nkosi'] });
  });

  it('blocks a company that matches the sanctions list', async () => {
    company();
    vi.mocked(axios.post).mockResolvedValue({ data: { matches: [{ matchedName: 'ACME LOGISTICS' }] } });

    await expect(screenEmployer(OWNER_ID)).rejects.toThrow(/blocked pending compliance review/);
  });

  it('fails closed when the compliance service cannot be reached', async () => {
    company();
    vi.mocked(axios.post).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(screenEmployer(OWNER_ID)).rejects.toThrow(ComplianceBlockedError);
  });

  it('has nothing to screen for an account with no names', async () => {
    company({ company_name: null, first_name: null, last_name: null });
    await expect(screenEmployer(OWNER_ID)).resolves.toBeUndefined();
    expect(axios.post).not.toHaveBeenCalled();
  });
});
