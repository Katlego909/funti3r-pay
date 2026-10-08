import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import * as escrow from '../lib/escrow.js';

// setup.ts replaces lib/clearance.js for the route tests; here the real module
// is the unit under test, with the chain calls (lib/escrow.js) mocked.
const { ensureCleared, ComplianceBlockedError } =
  await vi.importActual<typeof import('../lib/clearance.js')>('../lib/clearance.js');

const WORKER_ID = 'worker-1111-1111-1111-111111111111';
const WORKER_PUB = 'GDESTWORKERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const verified = {
  status: 'verified',
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
      expect.objectContaining({ workerId: WORKER_ID, sanctions_status: 'clear', sanctions_checked_at: verified.sanctions_checked_at }),
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
