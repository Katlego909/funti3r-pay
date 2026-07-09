import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as escrow from '../lib/escrow.js';
import app from '../app.js';
import { createQueryMock, WORKER_ID, ENTERPRISE_ID, ADMIN_ID, MEMBER_ID } from './helpers.js';

const ESCROW_ID = 'escrow-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const enterpriseHeaders = { 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' };
const workerHeaders = { 'x-user-id': WORKER_ID, 'x-user-role': 'worker' };

// ── Query handlers specific to the escrow routes ─────────────────────────────

const HANDLER_WORKER_LOOKUP = {
  match: /SELECT stellar_public_key, email FROM users/,
  handler: () => ({ rows: [{ stellar_public_key: 'GDESTWORKERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', email: 'worker@test.com' }] }),
};

const HANDLER_COMPANY_WORKER = {
  match: /FROM enterprise_workers WHERE enterprise_id/,
  handler: () => ({ rows: [{ '?column?': 1 }] }),
};

const HANDLER_SECRET = {
  match: /^SELECT stellar_secret_key FROM users/,
  handler: () => ({ rows: [{ stellar_secret_key: 'SFAKESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }] }),
};

const HANDLER_ESCROW_INSERT = {
  match: /INSERT INTO escrows/,
  handler: () => ({ rows: [{ id: ESCROW_ID }] }),
};

/** Escrow row as the enterprise-scoped SELECTs return it. */
function escrowRowHandler(overrides: Record<string, unknown> = {}) {
  return {
    match: /FROM escrows\s+WHERE id = \$1 AND enterprise_id|FROM escrows WHERE id = \$1 AND enterprise_id/,
    handler: () => ({
      rows: [{
        id: ESCROW_ID, worker_id: WORKER_ID, enterprise_id: ENTERPRISE_ID,
        onchain_escrow_id: '0', status: 'active',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ...overrides,
      }],
    }),
  };
}

const HANDLER_ESCROW_BY_WORKER = {
  match: /FROM escrows WHERE id = \$1 AND worker_id/,
  handler: () => ({
    rows: [{ id: ESCROW_ID, enterprise_id: ENTERPRISE_ID, onchain_escrow_id: '0', status: 'active' }],
  }),
};

function milestoneHandler(status: string, amount = '25') {
  return {
    match: /FROM escrow_milestones WHERE escrow_id = \$1 AND idx/,
    handler: () => ({ rows: [{ status, amount }] }),
  };
}

beforeEach(() => {
  vi.mocked(query).mockReset().mockImplementation(createQueryMock([]));
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
  vi.mocked(escrow.createEscrow).mockReset();
  vi.mocked(escrow.approveMilestone).mockReset();
  vi.mocked(escrow.claimMilestone).mockReset();
  vi.mocked(escrow.refundEscrow).mockReset();
});

// ── POST /escrows ─────────────────────────────────────────────────────────────

describe('POST /escrows — authorization and validation', () => {
  it('403s for worker role', async () => {
    const res = await request(app).post('/escrows').set(workerHeaders)
      .send({ workerId: WORKER_ID, milestones: [{ amountXlm: 10 }], expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(res.status).toBe(403);
  });

  it('403s for a company member — escrow funding is owner/admin-only', async () => {
    const res = await request(app).post('/escrows')
      .set({ 'x-user-id': MEMBER_ID, 'x-user-role': 'enterprise' })
      .send({ workerId: WORKER_ID, milestones: [{ amountXlm: 10 }], expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owners and admins/);
  });

  it('400s on empty milestones and on a past expiry', async () => {
    const noMilestones = await request(app).post('/escrows').set(enterpriseHeaders)
      .send({ workerId: WORKER_ID, milestones: [], expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(noMilestones.status).toBe(400);

    const pastExpiry = await request(app).post('/escrows').set(enterpriseHeaders)
      .send({ workerId: WORKER_ID, milestones: [{ amountXlm: 10 }], expiresAt: '2020-01-01' });
    expect(pastExpiry.status).toBe(400);
  });

  it('creates on-chain then mirrors escrow + milestones into the DB (admin allowed)', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      HANDLER_WORKER_LOOKUP, HANDLER_COMPANY_WORKER, HANDLER_SECRET, HANDLER_ESCROW_INSERT,
    ]));
    vi.mocked(escrow.createEscrow).mockResolvedValue({ escrowId: 0n, hash: 'tx-escrow-create' });

    const res = await request(app).post('/escrows')
      .set({ 'x-user-id': ADMIN_ID, 'x-user-role': 'enterprise' })
      .send({
        workerId: WORKER_ID,
        milestones: [{ description: 'Design', amountXlm: 25 }, { description: 'Build', amountXlm: 40 }],
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: ESCROW_ID, onchainEscrowId: '0', txHash: 'tx-escrow-create' });
    expect(escrow.createEscrow).toHaveBeenCalledTimes(1);
    // Both milestone rows inserted in one statement.
    const milestoneInsert = vi.mocked(query).mock.calls.find(([sql]) => /INSERT INTO escrow_milestones/.test(sql));
    expect(milestoneInsert?.[1]).toHaveLength(8); // 2 rows × 4 params
  });

  it('502s with the on-chain reason when the contract call fails', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      HANDLER_WORKER_LOOKUP, HANDLER_COMPANY_WORKER, HANDLER_SECRET,
    ]));
    vi.mocked(escrow.createEscrow).mockRejectedValue(new Error('Escrow create failed on-chain: FAILED'));

    const res = await request(app).post('/escrows').set(enterpriseHeaders)
      .send({ workerId: WORKER_ID, milestones: [{ amountXlm: 10 }], expiresAt: new Date(Date.now() + 86_400_000).toISOString() });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/on-chain/);
  });
});

// ── approve / claim ───────────────────────────────────────────────────────────

describe('milestone approve and claim', () => {
  it('enterprise approves a pending milestone', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      escrowRowHandler(), milestoneHandler('pending'), HANDLER_SECRET,
    ]));
    vi.mocked(escrow.approveMilestone).mockResolvedValue('tx-approve');

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/approve`).set(enterpriseHeaders);
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('tx-approve');
  });

  it('409s approving a milestone that is not pending', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      escrowRowHandler(), milestoneHandler('approved'),
    ]));
    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/approve`).set(enterpriseHeaders);
    expect(res.status).toBe(409);
    expect(escrow.approveMilestone).not.toHaveBeenCalled();
  });

  it('worker claims an approved milestone', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      HANDLER_ESCROW_BY_WORKER, milestoneHandler('approved'), HANDLER_SECRET,
    ]));
    vi.mocked(escrow.claimMilestone).mockResolvedValue('tx-claim');

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders);
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('tx-claim');
  });

  it('403s a claim from an enterprise account', async () => {
    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(enterpriseHeaders);
    expect(res.status).toBe(403);
  });

  it('409s claiming a milestone that is not approved', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      HANDLER_ESCROW_BY_WORKER, milestoneHandler('pending'),
    ]));
    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders);
    expect(res.status).toBe(409);
    expect(escrow.claimMilestone).not.toHaveBeenCalled();
  });
});

// ── refund ────────────────────────────────────────────────────────────────────

describe('POST /escrows/:id/refund', () => {
  it('400s before expiry', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([escrowRowHandler()]));
    const res = await request(app).post(`/escrows/${ESCROW_ID}/refund`).set(enterpriseHeaders);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not expired/);
    expect(escrow.refundEscrow).not.toHaveBeenCalled();
  });

  it('refunds after expiry and reports the XLM amount', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      escrowRowHandler({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
      HANDLER_SECRET,
    ]));
    vi.mocked(escrow.refundEscrow).mockResolvedValue({ refundedStroops: 400_000_000n, hash: 'tx-refund' });

    const res = await request(app).post(`/escrows/${ESCROW_ID}/refund`).set(enterpriseHeaders);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ refundedXlm: 40, txHash: 'tx-refund' });
  });
});

// ── list ──────────────────────────────────────────────────────────────────────

describe('GET /escrows', () => {
  it('returns the company-scoped list with milestones for an enterprise', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      {
        match: /FROM escrows e/,
        handler: () => ({
          rows: [{
            id: ESCROW_ID, worker_id: WORKER_ID, worker_email: 'worker@test.com',
            onchain_escrow_id: '0', contract_address: 'CESCROW', token_code: 'XLM',
            total_amount: '65', status: 'active',
            expires_at: new Date().toISOString(), create_tx_hash: 'tx-escrow-create',
            created_at: new Date().toISOString(),
          }],
        }),
      },
      {
        match: /FROM escrow_milestones WHERE escrow_id = ANY/,
        handler: () => ({
          rows: [
            { escrow_id: ESCROW_ID, idx: 0, description: 'Design', amount: '25', status: 'claimed', approved_at: null, claimed_at: null, claim_tx_hash: 'tx-claim' },
            { escrow_id: ESCROW_ID, idx: 1, description: 'Build', amount: '40', status: 'pending', approved_at: null, claimed_at: null, claim_tx_hash: null },
          ],
        }),
      },
    ]));

    const res = await request(app).get('/escrows').set(enterpriseHeaders);
    expect(res.status).toBe(200);
    expect(res.body.escrows).toHaveLength(1);
    expect(res.body.escrows[0]).toMatchObject({ totalXlm: 65, workerEmail: 'worker@test.com' });
    expect(res.body.escrows[0].milestones).toHaveLength(2);
  });
});
