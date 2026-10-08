import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as escrow from '../lib/escrow.js';
import { ensureCleared, ComplianceBlockedError } from '../lib/clearance.js';
import { anchorConfigured, sendAnchorPayout } from '../rails/anchor.js';
import { AnchorActionRequiredError, AnchorAmountMismatchError } from '../lib/anchor.js';
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

const HANDLER_WORKER_PUBKEY = {
  match: /^SELECT stellar_public_key FROM users WHERE id/,
  handler: () => ({ rows: [{ stellar_public_key: 'GDESTWORKERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }] }),
};

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
  vi.mocked(ensureCleared).mockReset().mockResolvedValue({ cleared: true });
  vi.mocked(anchorConfigured).mockReset().mockReturnValue(true);
  vi.mocked(sendAnchorPayout).mockReset();
  vi.mocked(escrow.setFrozen).mockReset();
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
      escrowRowHandler(), milestoneHandler('pending'), HANDLER_SECRET, HANDLER_WORKER_PUBKEY,
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
      HANDLER_ESCROW_BY_WORKER, milestoneHandler('approved'), HANDLER_SECRET, HANDLER_WORKER_PUBKEY,
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

// ── compliance gate ───────────────────────────────────────────────────────────

describe('compliance gate', () => {
  const body = () => ({
    workerId: WORKER_ID,
    milestones: [{ amountXlm: 10 }],
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });

  it('403s escrow creation and never touches the chain when the worker is blocked', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([HANDLER_WORKER_LOOKUP, HANDLER_COMPANY_WORKER, HANDLER_SECRET]));
    vi.mocked(ensureCleared).mockRejectedValue(new ComplianceBlockedError('Worker is blocked pending compliance review (sanctions match)'));

    const res = await request(app).post('/escrows').set(enterpriseHeaders).send(body());
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'compliance_blocked' });
    expect(escrow.createEscrow).not.toHaveBeenCalled();
  });

  it('403s approving a milestone for a worker who is no longer cleared', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      escrowRowHandler(), milestoneHandler('pending'), HANDLER_SECRET, HANDLER_WORKER_PUBKEY,
    ]));
    vi.mocked(ensureCleared).mockRejectedValue(new ComplianceBlockedError('Worker KYC not verified'));

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/approve`).set(enterpriseHeaders);
    expect(res.status).toBe(403);
    expect(escrow.approveMilestone).not.toHaveBeenCalled();
  });

  it('re-screens at claim time: a flagged worker cannot claim an approved milestone', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      HANDLER_ESCROW_BY_WORKER, milestoneHandler('approved'), HANDLER_SECRET, HANDLER_WORKER_PUBKEY,
    ]));
    vi.mocked(ensureCleared).mockRejectedValue(new ComplianceBlockedError('Worker is blocked pending compliance review (sanctions match)'));

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('compliance_blocked');
    expect(escrow.claimMilestone).not.toHaveBeenCalled();
  });

  it("maps the contract's own gate rejection (#11 NotCleared) to 403", async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      HANDLER_ESCROW_BY_WORKER, milestoneHandler('approved'), HANDLER_SECRET, HANDLER_WORKER_PUBKEY,
    ]));
    vi.mocked(escrow.claimMilestone).mockRejectedValue(new escrow.EscrowContractError(11, 'claim'));

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'compliance_blocked', contractCode: 11 });
  });

  it('maps a business-rule contract rejection to 409', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      HANDLER_ESCROW_BY_WORKER, milestoneHandler('approved'), HANDLER_SECRET, HANDLER_WORKER_PUBKEY,
    ]));
    vi.mocked(escrow.claimMilestone).mockRejectedValue(new escrow.EscrowContractError(8, 'claim'));

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('contract_rejected');
  });
});

// ── anchor cash-out ───────────────────────────────────────────────────────────

describe('anchor cash-out', () => {
  const HANDLER_TAKE_CASHOUT = {
    match: /UPDATE escrow_milestones SET cashout_status = 'pending'/,
    handler: () => ({ rows: [{ amount: '25' }] }),
  };
  const HANDLER_ALREADY_TAKEN = {
    match: /UPDATE escrow_milestones SET cashout_status = 'pending'/,
    handler: () => ({ rows: [] }),
  };
  const HANDLER_WORKER_PAYOUT = {
    match: /^SELECT stellar_secret_key, payout_details FROM users/,
    handler: () => ({ rows: [{ stellar_secret_key: 'SFAKESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', payout_details: { bank_account_number: '123' } }] }),
  };
  const claimHandlers = [
    HANDLER_ESCROW_BY_WORKER, milestoneHandler('approved'), HANDLER_SECRET, HANDLER_WORKER_PUBKEY, HANDLER_WORKER_PAYOUT,
  ];

  it('claim with cashout=anchor claims on-chain then settles through the anchor', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...claimHandlers, HANDLER_TAKE_CASHOUT]));
    vi.mocked(escrow.claimMilestone).mockResolvedValue('tx-claim');
    vi.mocked(sendAnchorPayout).mockResolvedValue({ settlementHash: 'tx-settle', anchorTxId: 'anchor-1', anchorStatus: 'completed' });

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders).send({ cashout: 'anchor' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      txHash: 'tx-claim',
      cashout: { status: 'completed', anchorTxId: 'anchor-1', settlementHash: 'tx-settle', anchorStatus: 'completed' },
    });
    expect(sendAnchorPayout).toHaveBeenCalledWith(expect.objectContaining({ amountXlm: '25', kyc: { bank_account_number: '123' } }));
  });

  it('keeps the claim and records a retryable failure when the anchor leg fails', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...claimHandlers, HANDLER_TAKE_CASHOUT]));
    vi.mocked(escrow.claimMilestone).mockResolvedValue('tx-claim');
    vi.mocked(sendAnchorPayout).mockRejectedValue(new Error('Anchor minimum disbursement is 30 XLM'));

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders).send({ cashout: 'anchor' });
    expect(res.status).toBe(200); // the claim itself succeeded
    expect(res.body.txHash).toBe('tx-claim');
    expect(res.body.cashout).toMatchObject({ status: 'failed', error: expect.stringMatching(/minimum/) });
    const failedWrite = vi.mocked(query).mock.calls.find(([sql]) => /cashout_status = 'failed'/.test(sql));
    expect(failedWrite).toBeDefined();
  });

  it('parks the cash-out as action_required (not failed) when the anchor wants a step on its own site', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...claimHandlers, HANDLER_TAKE_CASHOUT]));
    vi.mocked(escrow.claimMilestone).mockResolvedValue('tx-claim');
    vi.mocked(sendAnchorPayout).mockRejectedValue(new AnchorActionRequiredError('anchor-9', 'https://anchor.example/complete'));

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders).send({ cashout: 'anchor' });
    expect(res.status).toBe(200);
    expect(res.body.cashout).toEqual({
      status: 'action_required', anchorTxId: 'anchor-9', moreInfoUrl: 'https://anchor.example/complete',
    });
    const parked = vi.mocked(query).mock.calls.find(([sql]) => /cashout_status = 'action_required'/.test(sql) && /anchor_more_info_url = \$4/.test(sql));
    expect(parked?.[1]).toEqual([ESCROW_ID, 0, 'anchor-9', 'https://anchor.example/complete']);
    // Parked, not failed: nothing is recorded as an error.
    expect(vi.mocked(query).mock.calls.some(([sql]) => /cashout_status = 'failed'/.test(sql))).toBe(false);
  });

  it('resumes the SAME anchor transaction and never re-sends a settlement that already happened', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      HANDLER_WORKER_PUBKEY, HANDLER_WORKER_PAYOUT,
      { match: /FROM escrow_milestones m JOIN escrows e/, handler: () => ({ rows: [{ status: 'claimed', cashout_status: 'failed' }] }) },
      {
        match: /UPDATE escrow_milestones SET cashout_status = 'pending'/,
        handler: () => ({ rows: [{ amount: '10', anchor_tx_id: 'anchor-9', anchor_protocol: 'sep24', anchor_settlement_hash: 'tx-already-sent', anchor_more_info_url: 'https://anchor.example/form' }] }),
      },
    ]));
    vi.mocked(sendAnchorPayout).mockResolvedValue({ settlementHash: 'tx-already-sent', anchorTxId: 'anchor-9', anchorStatus: 'completed' });

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/cashout`).set(workerHeaders);
    expect(res.status).toBe(200);
    expect(sendAnchorPayout).toHaveBeenCalledWith(expect.objectContaining({
      resume: { anchorTxId: 'anchor-9', protocol: 'sep24', settlementHash: 'tx-already-sent', interactiveUrl: 'https://anchor.example/form' },
    }));
  });

  it('fails loudly and forgets the anchor transaction when the form amount differs from the payout', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([...claimHandlers, HANDLER_TAKE_CASHOUT]));
    vi.mocked(escrow.claimMilestone).mockResolvedValue('tx-claim');
    vi.mocked(sendAnchorPayout).mockRejectedValue(new AnchorAmountMismatchError('10', '5'));

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders).send({ cashout: 'anchor' });
    expect(res.body.cashout).toMatchObject({ status: 'failed', error: expect.stringMatching(/5 XLM.*10 XLM/) });
    // The wrong-amount anchor tx is cleared so a retry starts fresh — but only when nothing was paid.
    const reset = vi.mocked(query).mock.calls.find(([sql]) => /anchor_tx_id = NULL/.test(sql) && /anchor_settlement_hash IS NULL/.test(sql));
    expect(reset).toBeDefined();
  });

  it('starts a fresh anchor transaction when the parked one has no usable form link (status page / expired)', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      HANDLER_WORKER_PUBKEY, HANDLER_WORKER_PAYOUT,
      { match: /FROM escrow_milestones m JOIN escrows e/, handler: () => ({ rows: [{ status: 'claimed', cashout_status: 'action_required' }] }) },
      {
        match: /UPDATE escrow_milestones SET cashout_status = 'pending'/,
        handler: () => ({ rows: [{ amount: '10', anchor_tx_id: 'old-tx', anchor_protocol: 'sep24', anchor_settlement_hash: null, anchor_more_info_url: 'https://anchor.example/txn?transaction_id=old-tx&token=x' }] }),
      },
    ]));
    vi.mocked(sendAnchorPayout).mockRejectedValue(new AnchorActionRequiredError('new-tx', 'https://anchor.example/?transaction_id=new-tx&token=y'));

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/cashout`).set(workerHeaders);
    expect(res.body.cashout).toMatchObject({ status: 'action_required', anchorTxId: 'new-tx' });
    expect(vi.mocked(sendAnchorPayout).mock.calls[0][0].resume).toBeUndefined();
  });

  it('never restarts when a settlement was already paid, even if the form link is unusable', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      HANDLER_WORKER_PUBKEY, HANDLER_WORKER_PAYOUT,
      { match: /FROM escrow_milestones m JOIN escrows e/, handler: () => ({ rows: [{ status: 'claimed', cashout_status: 'failed' }] }) },
      {
        match: /UPDATE escrow_milestones SET cashout_status = 'pending'/,
        handler: () => ({ rows: [{ amount: '10', anchor_tx_id: 'old-tx', anchor_protocol: 'sep24', anchor_settlement_hash: 'tx-paid', anchor_more_info_url: 'https://anchor.example/txn?x=1' }] }),
      },
    ]));
    vi.mocked(sendAnchorPayout).mockResolvedValue({ settlementHash: 'tx-paid', anchorTxId: 'old-tx', anchorStatus: 'completed' });

    await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/cashout`).set(workerHeaders);
    expect(vi.mocked(sendAnchorPayout).mock.calls[0][0].resume).toMatchObject({ anchorTxId: 'old-tx', settlementHash: 'tx-paid' });
  });

  it('a plain claim never touches the anchor', async () => {
    vi.mocked(query).mockImplementation(createQueryMock(claimHandlers));
    vi.mocked(escrow.claimMilestone).mockResolvedValue('tx-claim');
    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders);
    expect(res.status).toBe(200);
    expect(res.body.cashout).toBeUndefined();
    expect(sendAnchorPayout).not.toHaveBeenCalled();
  });

  it('rejects an anchor claim up front when no anchor is configured (nothing moves on-chain)', async () => {
    vi.mocked(anchorConfigured).mockReturnValue(false);
    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders).send({ cashout: 'anchor' });
    expect(res.status).toBe(400);
    expect(escrow.claimMilestone).not.toHaveBeenCalled();
  });

  it('retry endpoint cashes out a claimed milestone', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /FROM escrow_milestones m JOIN escrows e/, handler: () => ({ rows: [{ status: 'claimed', cashout_status: 'failed' }] }) },
      HANDLER_WORKER_PUBKEY, HANDLER_WORKER_PAYOUT, HANDLER_TAKE_CASHOUT,
    ]));
    vi.mocked(sendAnchorPayout).mockResolvedValue({ settlementHash: 'tx-settle', anchorTxId: 'anchor-2', anchorStatus: 'pending_anchor' });

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/cashout`).set(workerHeaders);
    expect(res.status).toBe(200);
    expect(res.body.cashout).toMatchObject({ status: 'completed', anchorTxId: 'anchor-2' });
  });

  it('409s a cash-out that is already in progress or done (no double-send)', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /FROM escrow_milestones m JOIN escrows e/, handler: () => ({ rows: [{ status: 'claimed', cashout_status: 'completed' }] }) },
      HANDLER_WORKER_PUBKEY, HANDLER_ALREADY_TAKEN,
    ]));
    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/cashout`).set(workerHeaders);
    expect(res.status).toBe(409);
    expect(sendAnchorPayout).not.toHaveBeenCalled();
  });

  it('409s cashing out a milestone that has not been claimed', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /FROM escrow_milestones m JOIN escrows e/, handler: () => ({ rows: [{ status: 'approved', cashout_status: 'none' }] }) },
    ]));
    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/cashout`).set(workerHeaders);
    expect(res.status).toBe(409);
  });

  it('re-screens before a cash-out: a flagged worker cannot send funds to the anchor', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /FROM escrow_milestones m JOIN escrows e/, handler: () => ({ rows: [{ status: 'claimed', cashout_status: 'none' }] }) },
      HANDLER_WORKER_PUBKEY,
    ]));
    vi.mocked(ensureCleared).mockRejectedValue(new ComplianceBlockedError('Worker is blocked pending compliance review (sanctions match)'));
    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/cashout`).set(workerHeaders);
    expect(res.status).toBe(403);
    expect(sendAnchorPayout).not.toHaveBeenCalled();
  });
});

// ── compliance freeze ─────────────────────────────────────────────────────────

describe('POST /escrows/:id/freeze', () => {
  const adminHeaders = { 'x-user-id': ADMIN_ID, 'x-user-role': 'admin' };

  it('403s anyone who is not a platform admin (enterprise owners cannot freeze their own escrow)', async () => {
    const res = await request(app).post(`/escrows/${ESCROW_ID}/freeze`).set(enterpriseHeaders).send({ frozen: true });
    expect(res.status).toBe(403);
    expect(escrow.setFrozen).not.toHaveBeenCalled();
  });

  it('freezes on-chain and mirrors the flag', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /SELECT onchain_escrow_id FROM escrows/, handler: () => ({ rows: [{ onchain_escrow_id: '3' }] }) },
    ]));
    vi.mocked(escrow.setFrozen).mockResolvedValue('tx-freeze');

    const res = await request(app).post(`/escrows/${ESCROW_ID}/freeze`).set(adminHeaders).send({ frozen: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frozen: true, txHash: 'tx-freeze' });
    expect(escrow.setFrozen).toHaveBeenCalledWith(3n, true);
  });

  it('400s a non-boolean frozen value', async () => {
    const res = await request(app).post(`/escrows/${ESCROW_ID}/freeze`).set(adminHeaders).send({ frozen: 'yes' });
    expect(res.status).toBe(400);
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
