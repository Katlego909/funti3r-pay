import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as escrowLib from '../lib/escrow.js';
import app from '../app.js';
import { recordEscrowPayment, recordEscrowPaymentSafely, recordAllMissingEscrowPayments } from '../lib/escrowAccounting.js';
import { reconcileEscrows } from '../lib/escrowReconcile.js';
import { createQueryMock, WORKER_ID, ENTERPRISE_ID, MEMBER_ID } from './helpers.js';

const ESCROW_ID = 'escrow-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const workerHeaders = { 'x-user-id': WORKER_ID, 'x-user-role': 'worker' };
const enterpriseHeaders = { 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' };

const payments = () => vi.mocked(query).mock.calls.filter(([sql]) => /INSERT INTO payments/.test(sql));

beforeEach(() => {
  vi.mocked(query).mockReset().mockImplementation(createQueryMock([]));
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
  vi.mocked(escrowLib.getEscrow).mockReset();
  process.env.ESCROW_CONTRACT_ADDRESS = 'CESCROWCONTRACT';
});

describe('recordEscrowPayment', () => {
  it('books a claimed milestone as ONE completed XLM payment on the escrow rail, keyed for idempotency', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([{ match: /INSERT INTO payments/, handler: () => ({ rows: [{ id: 'p1' }] }) }]));

    expect(await recordEscrowPayment(ESCROW_ID, 0)).toBe(true);

    const [sql, params] = payments()[0] as [string, unknown[]];
    expect(params).toEqual([ESCROW_ID, 0]);
    expect(sql).toMatch(/'XLM', 'completed'/);               // the contract pays XLM; the worker has it
    expect(sql).toMatch(/'escrow:' \|\| e\.id::text \|\| ':' \|\| m\.idx, 'escrow'/); // idempotency key + rail
    expect(sql).toMatch(/ON CONFLICT \(enterprise_id, idempotency_key\) WHERE idempotency_key IS NOT NULL DO NOTHING/);
    expect(sql).toMatch(/m\.status = 'claimed'/);             // only money the worker actually received
  });

  it('is a no-op the second time (the unique key swallows it)', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([{ match: /INSERT INTO payments/, handler: () => ({ rows: [] }) }]));
    expect(await recordEscrowPayment(ESCROW_ID, 0)).toBe(false);
  });

  it('never throws from the safe wrapper — a bookkeeping failure must not undo a real claim', async () => {
    vi.mocked(query).mockRejectedValue(new Error('db down'));
    await expect(recordEscrowPaymentSafely(ESCROW_ID, 0)).resolves.toBeUndefined();
  });

  it('the sweep reports how many claimed milestones it had to add', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([{ match: /INSERT INTO payments/, handler: () => ({ rows: [{ id: 'a' }, { id: 'b' }] }) }]));
    expect(await recordAllMissingEscrowPayments()).toBe(2);
  });
});

describe('claim route', () => {
  const HANDLERS = [
    { match: /FROM escrows WHERE id = \$1 AND worker_id/, handler: () => ({ rows: [{ id: ESCROW_ID, enterprise_id: ENTERPRISE_ID, onchain_escrow_id: '0', status: 'active' }] }) },
    { match: /FROM escrow_milestones WHERE escrow_id = \$1 AND idx/, handler: () => ({ rows: [{ status: 'approved', amount: '25' }] }) },
    { match: /^SELECT stellar_secret_key FROM users/, handler: () => ({ rows: [{ stellar_secret_key: 'SFAKE' }] }) },
    { match: /^SELECT stellar_public_key FROM users WHERE id/, handler: () => ({ rows: [{ stellar_public_key: 'GWORKER' }] }) },
  ];
  const claim = () => request(app).post(`/escrows/${ESCROW_ID}/milestones/0/claim`).set(workerHeaders);

  it('puts the claim in the books (Total Received / Payment History) right after the on-chain claim', async () => {
    vi.mocked(query).mockImplementation(createQueryMock(HANDLERS));
    vi.mocked(escrowLib.claimMilestone).mockResolvedValue('tx-claim');

    const res = await claim();
    expect(res.status).toBe(200);
    expect(payments()).toHaveLength(1);
    expect(payments()[0][1]).toEqual([ESCROW_ID, 0]);
  });

  it('a failing bookkeeping write never turns a successful claim into an error', async () => {
    vi.mocked(query).mockImplementation(vi.fn(async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO payments/.test(sql)) throw new Error('db hiccup');
      return createQueryMock(HANDLERS)(sql, params);
    }) as never);
    vi.mocked(escrowLib.claimMilestone).mockResolvedValue('tx-claim');

    const res = await claim();
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('tx-claim');
  });
});

describe('reconciler', () => {
  it('a claim the reconciler repairs from the chain is booked as a payment too', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /FROM escrows\s+WHERE contract_address/, handler: () => ({ rows: [{ id: ESCROW_ID, onchain_escrow_id: '3', status: 'active', frozen: false }] }) },
      { match: /SELECT idx, status FROM escrow_milestones/, handler: () => ({ rows: [{ idx: 0, status: 'approved' }] }) },
    ]));
    vi.mocked(escrowLib.getEscrow).mockResolvedValue({
      enterprise: 'E', worker: 'W', token: 'T', amounts: [100n], milestones: ['Claimed'],
      expiry: 0n, status: 'Completed', frozen: false,
    });

    await reconcileEscrows();
    expect(payments()).toHaveLength(1);
    expect(payments()[0][1]).toEqual([ESCROW_ID, 0]);
  });

  it('does not touch the books when nothing was repaired', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /FROM escrows\s+WHERE contract_address/, handler: () => ({ rows: [{ id: ESCROW_ID, onchain_escrow_id: '3', status: 'active', frozen: false }] }) },
      { match: /SELECT idx, status FROM escrow_milestones/, handler: () => ({ rows: [{ idx: 0, status: 'pending' }] }) },
    ]));
    vi.mocked(escrowLib.getEscrow).mockResolvedValue({
      enterprise: 'E', worker: 'W', token: 'T', amounts: [100n], milestones: ['Pending'],
      expiry: 0n, status: 'Active', frozen: false,
    });
    await reconcileEscrows();
    expect(payments()).toHaveLength(0);
  });
});

describe('GET /escrows/summary', () => {
  const ROW = { locked: '10.0000000', claimed: '192.0000000', refunded: '40.0000000', cashed_out: '150.0000000' };
  const SUMMARY = { match: /FROM escrow_milestones m JOIN escrows e ON e\.id = m\.escrow_id\s+WHERE e\.(worker_id|enterprise_id)/, handler: () => ({ rows: [ROW] }) };

  it('403s without an identity', async () => {
    expect((await request(app).get('/escrows/summary')).status).toBe(403);
  });

  it('gives a worker their own escrow money, in XLM, split into locked / claimed / refunded / cashed out', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([SUMMARY]));
    const res = await request(app).get('/escrows/summary').set(workerHeaders);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lockedXlm: 10, claimedXlm: 192, refundedXlm: 40, cashedOutXlm: 150 });

    const [sql, params] = vi.mocked(query).mock.calls.find(([q]) => /FROM escrow_milestones m JOIN escrows e/.test(q)) as [string, unknown[]];
    expect(sql).toMatch(/WHERE e\.worker_id = \$1/);
    expect(params).toEqual([WORKER_ID]); // scoped to the caller, never someone else's
  });

  it('scopes an employer to their company', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([SUMMARY]));
    const res = await request(app).get('/escrows/summary').set(enterpriseHeaders);
    expect(res.status).toBe(200);
    const [sql, params] = vi.mocked(query).mock.calls.find(([q]) => /FROM escrow_milestones m JOIN escrows e/.test(q)) as [string, unknown[]];
    expect(sql).toMatch(/WHERE e\.enterprise_id = \$1/);
    expect(params).toEqual([ENTERPRISE_ID]);
  });

  it('returns zeros for someone with no escrows, and refuses other roles', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([{ ...SUMMARY, handler: () => ({ rows: [{}] }) }]));
    expect((await request(app).get('/escrows/summary').set(workerHeaders)).body)
      .toEqual({ lockedXlm: 0, claimedXlm: 0, refundedXlm: 0, cashedOutXlm: 0 });
    expect((await request(app).get('/escrows/summary').set({ 'x-user-id': 'x', 'x-user-role': 'nobody' })).status).toBe(403);
    expect(MEMBER_ID).toBeDefined();
  });
});
