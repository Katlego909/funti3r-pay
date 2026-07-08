import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import app from '../app.js';
import { createQueryMock, WORKER_ID, ENTERPRISE_ID, ADMIN_ID, MEMBER_ID, HANDLER_WORKER_FOUND_BULK, HANDLER_INSERT_PAYMENT } from './helpers.js';

const ENTERPRISE_SECRET_HANDLER = {
  match: /^SELECT stellar_secret_key FROM users/,
  handler: () => ({ rows: [{ stellar_secret_key: 'SENTERPRISESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }] }),
};
const NO_EXISTING_BATCH = { match: /payment_batches WHERE enterprise_id = \$1 AND idempotency_key/, handler: () => ({ rows: [] }) };
const BATCH_INSERT_OK = { match: /INSERT INTO payment_batches/, handler: () => ({ rows: [{ id: 'batch-1111-1111-1111-111111111111' }] }) };

const enterpriseHeaders = { 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' };

// Fixed, consistent across every test in this file — lib/fx.ts's getUsdRates()
// caches its result at module scope (10-min TTL), so whichever rates the
// FIRST test to need one populates the cache with are what every later test
// in this file effectively gets too. Using one fixed table everywhere avoids
// that cache-sharing from causing test-order-dependent flakiness.
const FX_RATES = { ZAR: 18.5, NGN: 1550 };

beforeEach(() => {
  vi.mocked(query).mockReset();
  // Default: ENTERPRISE_ID resolves as its own company's owner — matches the
  // pre-Phase-2 assumption that the requester IS the enterprise identity.
  vi.mocked(query).mockImplementation(createQueryMock([]));
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { result: 'success', rates: FX_RATES } });
  // Default: the batch route's one bulk compliance call reports every
  // requested worker as verified, so existing tests that don't care about
  // compliance specifics keep passing unmodified.
  vi.mocked(axios.post).mockReset().mockImplementation(async (_url, body: any) => ({
    data: { statuses: Object.fromEntries((body?.userIds ?? []).map((id: string) => [id, { status: 'verified' }])) },
  }));
  vi.mocked(stellar.sendPayment).mockReset();
  vi.mocked(stellar.payExactWithXlm).mockReset();
});

describe('POST /payouts/batch — authorization and validation', () => {
  it('403s when the requester role is not enterprise', async () => {
    const res = await request(app)
      .post('/payouts/batch')
      .set({ 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'worker' })
      .send({ items: [{ workerId: WORKER_ID, amountUsd: 1 }] });
    expect(res.status).toBe(403);
  });

  it('403s when requester is a company member (not owner/admin) — money movement is owner/admin-only', async () => {
    const res = await request(app)
      .post('/payouts/batch')
      .set({ 'x-user-id': MEMBER_ID, 'x-user-role': 'enterprise' })
      .send({ items: [{ workerId: WORKER_ID, amountUsd: 1 }] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owners and admins/);
  });

  it('admin can execute a batch payout', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, HANDLER_WORKER_FOUND_BULK, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.payExactWithXlm).mockResolvedValue({ hash: 'tx-admin-batch', sourceAmountXlm: '1.5' });

    const res = await request(app)
      .post('/payouts/batch')
      .set({ 'x-user-id': ADMIN_ID, 'x-user-role': 'enterprise' })
      .send({ items: [{ workerId: WORKER_ID, amountUsd: 1 }] });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('completed');
  });

  it('400s on an empty items array', async () => {
    const res = await request(app).post('/payouts/batch').set(enterpriseHeaders).send({ items: [] });
    expect(res.status).toBe(400);
  });

  it('400s when items exceeds 100', async () => {
    const items = Array.from({ length: 101 }, () => ({ workerId: WORKER_ID, amountUsd: 1 }));
    const res = await request(app).post('/payouts/batch').set(enterpriseHeaders).send({ items });
    expect(res.status).toBe(400);
  });

  it('400s when an item has a non-positive amountUsd', async () => {
    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({ items: [{ workerId: WORKER_ID, amountUsd: 0 }] });
    expect(res.status).toBe(400);
  });
});

describe('POST /payouts/batch — per-worker currency conversion', () => {
  const USDC_WORKER = WORKER_ID;
  const ZAR_WORKER = 'worker-zar-0000-0000-000000000000';

  const MIXED_CURRENCY_HANDLER = {
    match: /SELECT id, stellar_public_key, stellar_secret_key, email, preferred_currency FROM users WHERE id = ANY/,
    handler: (params: unknown[]) => ({
      rows: ((params[0] as string[]) ?? []).map((id) => ({
        id,
        stellar_public_key: 'GDESTWORKERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        stellar_secret_key: 'SWORKERSECRETKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        email: 'worker@test.com',
        preferred_currency: id === ZAR_WORKER ? 'ZAR' : 'USDC',
      })),
    }),
  };

  it('converts the same USD amount to each worker\'s own preferred currency', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, MIXED_CURRENCY_HANDLER, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.sendPayment).mockResolvedValue('tx-mixed-currency');
    vi.mocked(stellar.payExactWithXlm).mockResolvedValue({ hash: 'tx-mixed-zar', sourceAmountXlm: '1.5' });

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({
        items: [
          { workerId: USDC_WORKER, amountUsd: 10 },
          { workerId: ZAR_WORKER, amountUsd: 10 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.completedCount).toBe(2);
    const usdcResult = res.body.results.find((r: any) => r.workerId === USDC_WORKER);
    const zarResult = res.body.results.find((r: any) => r.workerId === ZAR_WORKER);
    expect(usdcResult.currency).toBe('USDC');
    expect(usdcResult.amount).toBe(10); // USDC is 1:1 with USD
    expect(zarResult.currency).toBe('ZAR');
    expect(zarResult.amount).toBe(185); // 10 USD * 18.5 ZAR/USD
  });

  it('fails only the item whose preferred currency is unsupported, others still complete', async () => {
    const UNSUPPORTED_WORKER = 'worker-unsupported-0000-0000-000000';
    const handler = {
      match: /SELECT id, stellar_public_key, stellar_secret_key, email, preferred_currency FROM users WHERE id = ANY/,
      handler: (params: unknown[]) => ({
        rows: ((params[0] as string[]) ?? []).map((id) => ({
          id,
          stellar_public_key: 'GDESTWORKERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          stellar_secret_key: 'SWORKERSECRETKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          email: 'worker@test.com',
          preferred_currency: id === UNSUPPORTED_WORKER ? 'ZZZ' : 'USDC',
        })),
      }),
    };
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, handler, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.payExactWithXlm).mockResolvedValue({ hash: 'tx-supported-only', sourceAmountXlm: '1.5' });

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({
        items: [
          { workerId: WORKER_ID, amountUsd: 5 },
          { workerId: UNSUPPORTED_WORKER, amountUsd: 5 },
        ],
      });

    expect(res.status).toBe(207);
    expect(res.body.completedCount).toBe(1);
    expect(res.body.failedCount).toBe(1);
    const failedResult = res.body.results.find((r: any) => r.workerId === UNSUPPORTED_WORKER);
    expect(failedResult.error).toMatch(/unsupported/i);
    // Never attempted a Stellar submission for the unsupported item.
    expect(stellar.payExactWithXlm).toHaveBeenCalledTimes(1);
  });

  it('records the completed total in USD, not a blended sum of raw per-currency amounts', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, MIXED_CURRENCY_HANDLER, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.sendPayment).mockResolvedValue('tx-usd-total');
    vi.mocked(stellar.payExactWithXlm).mockResolvedValue({ hash: 'tx-usd-total-zar', sourceAmountXlm: '1.5' });

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({
        items: [
          { workerId: USDC_WORKER, amountUsd: 10 },
          { workerId: ZAR_WORKER, amountUsd: 10 },
        ],
      });

    expect(res.status).toBe(201);
    // 10 USD + 10 USD = 20 USD total, NOT 10 (USDC) + 185 (ZAR) = 195.
    const totalAmountCall = vi.mocked(query).mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE payment_batches SET status'),
    );
    expect(totalAmountCall?.[1]?.[1]).toBe(20);
  });
});

describe('POST /payouts/batch — execution and result aggregation', () => {
  it('all items succeed → status completed, 201', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, HANDLER_WORKER_FOUND_BULK, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.payExactWithXlm).mockResolvedValue({ hash: 'tx-batch-item-1', sourceAmountXlm: '1.5' });

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({ items: [{ workerId: WORKER_ID, amountUsd: 1 }] });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('completed');
    expect(res.body.completedCount).toBe(1);
    expect(res.body.failedCount).toBe(0);
    expect(stellar.payExactWithXlm).toHaveBeenCalledTimes(1);
  });

  it('a partial failure → status partial, 207', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, HANDLER_WORKER_FOUND_BULK, HANDLER_INSERT_PAYMENT]),
    );
    // First item succeeds, second fails.
    vi.mocked(stellar.payExactWithXlm).mockResolvedValueOnce({ hash: 'tx-ok', sourceAmountXlm: '1.5' }).mockRejectedValueOnce(new Error('tx_failed'));

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({
        items: [{ workerId: WORKER_ID, amountUsd: 1 }, { workerId: WORKER_ID, amountUsd: 2 }],
      });

    expect(res.status).toBe(207);
    expect(res.body.status).toBe('partial');
    expect(res.body.completedCount).toBe(1);
    expect(res.body.failedCount).toBe(1);
  });

  it('idempotency: a different payload under the same batch key is rejected (422)', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([
        ENTERPRISE_SECRET_HANDLER,
        {
          match: /payment_batches WHERE enterprise_id = \$1 AND idempotency_key/,
          handler: () => ({ rows: [{ id: 'batch-1', status: 'completed', payload_hash: 'not-the-real-hash' }] }),
        },
      ]),
    );

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({ items: [{ workerId: WORKER_ID, amountUsd: 1 }], idempotencyKey: 'batch-key-1' });

    expect(res.status).toBe(422);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });

  it('idempotency: a batch already processing under the same key is rejected (409)', async () => {
    const items = [{ workerId: WORKER_ID, amountUsd: 1 }];
    const matchingHash = crypto.createHash('sha256')
      .update(JSON.stringify({ items: [{ workerId: WORKER_ID, amountUsd: 1, memo: undefined }] }))
      .digest('hex');
    vi.mocked(query).mockImplementation(
      createQueryMock([
        ENTERPRISE_SECRET_HANDLER,
        {
          match: /payment_batches WHERE enterprise_id = \$1 AND idempotency_key/,
          handler: () => ({ rows: [{ id: 'batch-1', status: 'processing', payload_hash: matchingHash }] }),
        },
      ]),
    );

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({ items, idempotencyKey: 'batch-key-1' });

    expect(res.status).toBe(409);
  });

  it('idempotency: a terminal batch under the same key replays from payments ground truth, no re-execution', async () => {
    const items = [{ workerId: WORKER_ID, amountUsd: 1 }];
    const matchingHash = crypto.createHash('sha256')
      .update(JSON.stringify({ items: [{ workerId: WORKER_ID, amountUsd: 1, memo: undefined }] }))
      .digest('hex');
    vi.mocked(query).mockImplementation(
      createQueryMock([
        ENTERPRISE_SECRET_HANDLER,
        {
          match: /payment_batches WHERE enterprise_id = \$1 AND idempotency_key/,
          handler: () => ({ rows: [{ id: 'batch-1', status: 'completed', payload_hash: matchingHash }] }),
        },
        {
          match: /FROM payments WHERE batch_id = \$1/,
          handler: () => ({ rows: [{ paymentId: 'p1', workerId: WORKER_ID, amount: '1.00', currency: 'USDC', status: 'completed', stellarTxHash: 'cached-tx', sourceAmountXlm: null }] }),
        },
      ]),
    );

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({ items, idempotencyKey: 'batch-key-1' });

    expect(res.status).toBe(201);
    expect(res.body.batchId).toBe('batch-1');
    expect(res.body.results[0].stellarTxHash).toBe('cached-tx');
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });
});

describe('POST /payouts/batch — bulk compliance check (N+1 fix)', () => {
  const WORKER_ID_2 = 'worker-2222-2222-2222-222222222222';

  it('resolves compliance for every item with exactly one bulk call, not one per item', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, HANDLER_WORKER_FOUND_BULK, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.payExactWithXlm).mockResolvedValue({ hash: 'tx-bulk-check', sourceAmountXlm: '1.5' });

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({
        items: [
          { workerId: WORKER_ID, amountUsd: 1 },
          { workerId: WORKER_ID_2, amountUsd: 2 },
          { workerId: WORKER_ID, amountUsd: 3 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.completedCount).toBe(3);
    expect(vi.mocked(axios.post).mock.calls.filter(([url]) => String(url).includes('/status/bulk'))).toHaveLength(1);
    const [, body] = vi.mocked(axios.post).mock.calls.find(([url]) => String(url).includes('/status/bulk'))!;
    expect((body as any).userIds).toEqual([WORKER_ID, WORKER_ID_2, WORKER_ID]);
  });

  it('blocks only the unverified item, using the same error message the single-payout path uses', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, HANDLER_WORKER_FOUND_BULK, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(axios.post).mockImplementation(async (url: string, body: any) => {
      if (String(url).includes('/status/bulk')) {
        return {
          data: {
            statuses: {
              [WORKER_ID]: { status: 'verified' },
              [WORKER_ID_2]: { status: 'pending' },
            },
          },
        };
      }
      throw new Error(`unexpected axios.post to ${url}`);
    });
    vi.mocked(stellar.payExactWithXlm).mockResolvedValue({ hash: 'tx-one-verified', sourceAmountXlm: '1.5' });

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({
        items: [{ workerId: WORKER_ID, amountUsd: 1 }, { workerId: WORKER_ID_2, amountUsd: 2 }],
      });

    expect(res.status).toBe(207);
    expect(res.body.completedCount).toBe(1);
    expect(res.body.failedCount).toBe(1);
    const failedResult = res.body.results.find((r: any) => r.workerId === WORKER_ID_2);
    expect(failedResult.error).toBe('Worker KYC not verified');
    expect(stellar.payExactWithXlm).toHaveBeenCalledTimes(1);
  });

  it('fails the whole batch safely (not per-item) if the bulk compliance call itself fails', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, HANDLER_WORKER_FOUND_BULK, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(axios.post).mockRejectedValue(new Error('compliance-service unreachable'));

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({
        items: [{ workerId: WORKER_ID, amountUsd: 1 }, { workerId: WORKER_ID_2, amountUsd: 2 }],
      });

    expect(res.status).toBe(207);
    expect(res.body.status).toBe('failed');
    expect(res.body.completedCount).toBe(0);
    expect(res.body.failedCount).toBe(2);
    for (const r of res.body.results) {
      expect(r.error).toBe('Compliance service unavailable');
    }
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });
});
