import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { query } from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import * as escrow from '../lib/escrow.js';
import app from '../app.js';
import { createQueryMock, ENTERPRISE_ID, WORKER_ID } from './helpers.js';

const admin = { 'x-user-id': '55555555-5555-4555-8555-555555555555', 'x-user-role': 'admin' };
const TX = 'ab'.repeat(32);
const sqlCalls = () => vi.mocked(query).mock.calls.map(([sql, params]) => ({ sql: String(sql), params: params as unknown[] }));

beforeEach(() => {
  vi.mocked(query).mockReset().mockImplementation(createQueryMock([]));
  vi.mocked(stellar.getAccountBalance).mockReset();
  vi.mocked(stellar.sponsorPublicKey).mockReset().mockReturnValue(null);
  vi.mocked(escrow.contractState).mockReset();
});

describe('admin money routes', () => {
  it('refuse anyone but a platform admin', async () => {
    for (const path of ['/admin/ops', '/admin/payments', '/admin/escrows', '/admin/cashouts', '/admin/batches', '/admin/schedules', '/admin/audit', `/admin/money/${WORKER_ID}`]) {
      for (const role of ['worker', 'enterprise']) {
        const res = await request(app).get(path).set({ 'x-user-id': ENTERPRISE_ID, 'x-user-role': role });
        expect(res.status, `${role} ${path}`).toBe(403);
      }
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('find a payment by its transaction hash, or everything to or from one account by its id', async () => {
    await request(app).get(`/admin/payments?q=${TX.toUpperCase()}&status=failed`).set(admin);
    let { sql, params } = sqlCalls()[0];
    expect(sql).toMatch(/p\.status = \$1 AND p\.stellar_tx_hash = \$2/);
    expect(params).toEqual(['failed', TX]);

    vi.mocked(query).mockClear();
    await request(app).get(`/admin/payments?q=${WORKER_ID}&status=nonsense&limit=9999`).set(admin);
    ({ sql, params } = sqlCalls()[0]);
    expect(sql).toMatch(/WHERE \$1 IN \(p\.id, p\.enterprise_id, p\.worker_id\)/); // an unknown status is ignored
    expect(sql).toMatch(/LIMIT 200 OFFSET 0/); // pages are capped
    expect(params).toEqual([WORKER_ID]);
  });

  it('never read a secret column', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /SELECT id, role, stellar_public_key FROM users/, handler: () => ({ rows: [{ id: WORKER_ID, role: 'worker', stellar_public_key: null }] }) },
    ]));
    for (const path of ['/admin/ops', '/admin/payments', '/admin/escrows', '/admin/cashouts', '/admin/batches', '/admin/schedules', '/admin/audit', `/admin/money/${WORKER_ID}`]) {
      await request(app).get(path).set(admin);
    }
    for (const { sql } of sqlCalls()) {
      expect(sql, sql).not.toMatch(/secret|password|SELECT \*|\.\*/i);
    }
  });

  it('show an account its wallet and history; one not on chain yet holds nothing; an unknown one is a 404', async () => {
    const ADDRESS = 'GCTJUFKWH7PJ6NPW4FG67C2AIBOSW5QPHXOS7UAF2MEKE7ZHATSB3YFN';
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /SELECT id, role, stellar_public_key FROM users/, handler: () => ({ rows: [{ id: WORKER_ID, role: 'worker', stellar_public_key: ADDRESS }] }) },
    ]));
    vi.mocked(stellar.getAccountBalance).mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }));
    const res = await request(app).get(`/admin/money/${WORKER_ID}`).set(admin);
    expect(res.status).toBe(200);
    expect(res.body.wallet).toEqual({ address: ADDRESS, balances: [] });

    vi.mocked(query).mockImplementation(createQueryMock([]));
    expect((await request(app).get(`/admin/money/${WORKER_ID}`).set(admin)).status).toBe(404);
    expect((await request(app).get('/admin/money/not-an-id').set(admin)).status).toBe(404);
  });

  it('report what needs attention; a failed chain read shows its error without breaking the page', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /GROUP BY 1/, handler: () => ({ rows: [{ reason: 'op_underfunded', count: 3 }, { reason: 'unknown', count: 1 }] }) },
    ]));
    vi.mocked(escrow.contractState).mockRejectedValue(new Error('RPC unreachable'));
    const res = await request(app).get('/admin/ops').set(admin);
    expect(res.status).toBe(200);
    expect(res.body.failedPayouts24h).toEqual({ total: 4, byReason: [{ reason: 'op_underfunded', count: 3 }, { reason: 'unknown', count: 1 }] });
    expect(res.body.sponsor).toBeNull(); // no sponsor configured
    expect(res.body.contract).toEqual({ error: 'RPC unreachable' });
    // Stuck means past the same limits the alerts use.
    expect(sqlCalls().some(({ sql }) => /status IN \('initiated', 'submitted'\) AND p\.created_at < NOW\(\) - INTERVAL '10 minutes'/.test(sql))).toBe(true);
  });

  it('narrow the audit trail, matching an action prefix literally and ignoring a malformed actor id', async () => {
    await request(app).get('/admin/audit?action=escrow.%&actorId=nope&entityType=escrow').set(admin);
    const { sql, params } = sqlCalls()[0];
    expect(sql).toMatch(/WHERE entity_type = \$1 AND action LIKE \$2/);
    expect(params).toEqual(['escrow', 'escrow.\\%%']);
  });

  it('open the payments of one payout batch, and list batches and schedules with an unknown status ignored', async () => {
    const BATCH = '66666666-6666-4666-8666-666666666666';
    await request(app).get(`/admin/payments?batchId=${BATCH}&status=completed`).set(admin);
    let { sql, params } = sqlCalls()[0];
    expect(sql).toMatch(/WHERE p\.status = \$1 AND p\.batch_id = \$2/);
    expect(params).toEqual(['completed', BATCH]);

    vi.mocked(query).mockClear();
    await request(app).get(`/admin/batches?status=partial&q=${ENTERPRISE_ID}`).set(admin);
    ({ sql, params } = sqlCalls()[0]);
    expect(sql).toMatch(/FROM payment_batches b/);
    expect(sql).toMatch(/WHERE b\.status = \$1 AND \$2 IN \(b\.id, b\.enterprise_id\)/);
    expect(sql).toMatch(/AS awaiting_claim/);
    expect(params).toEqual(['partial', ENTERPRISE_ID]);

    vi.mocked(query).mockClear();
    await request(app).get("/admin/schedules?status=paused' OR 1=1").set(admin);
    ({ sql, params } = sqlCalls()[0]);
    expect(sql).toMatch(/FROM payment_schedules s/);
    expect(sql).not.toMatch(/WHERE/);
    expect(params).toEqual([]);
  });
});
