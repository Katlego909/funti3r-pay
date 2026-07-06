import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import app from '../app.js';
import { createQueryMock, WORKER_ID, ENTERPRISE_ID, HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT } from './helpers.js';

const ENTERPRISE_SECRET_HANDLER = {
  match: /^SELECT stellar_secret_key FROM users/,
  handler: () => ({ rows: [{ stellar_secret_key: 'SENTERPRISESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }] }),
};
const NO_EXISTING_BATCH = { match: /payment_batches WHERE enterprise_id = \$1 AND idempotency_key/, handler: () => ({ rows: [] }) };
const BATCH_INSERT_OK = { match: /INSERT INTO payment_batches/, handler: () => ({ rows: [{ id: 'batch-1111-1111-1111-111111111111' }] }) };

const enterpriseHeaders = { 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' };

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
  vi.mocked(stellar.sendPayment).mockReset();
});

describe('POST /payouts/batch — authorization and validation', () => {
  it('403s when the requester role is not enterprise', async () => {
    const res = await request(app)
      .post('/payouts/batch')
      .set({ 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'worker' })
      .send({ enterpriseId: ENTERPRISE_ID, items: [{ workerId: WORKER_ID, amount: 1 }] });
    expect(res.status).toBe(403);
  });

  it('400s on an empty items array', async () => {
    const res = await request(app).post('/payouts/batch').set(enterpriseHeaders).send({ enterpriseId: ENTERPRISE_ID, items: [] });
    expect(res.status).toBe(400);
  });

  it('400s when items exceeds 100', async () => {
    const items = Array.from({ length: 101 }, () => ({ workerId: WORKER_ID, amount: 1 }));
    const res = await request(app).post('/payouts/batch').set(enterpriseHeaders).send({ enterpriseId: ENTERPRISE_ID, items });
    expect(res.status).toBe(400);
  });

  it('400s on an unsupported currency', async () => {
    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, currency: 'ZZZ', items: [{ workerId: WORKER_ID, amount: 1 }] });
    expect(res.status).toBe(400);
  });

  it('400s when an item has a non-positive amount', async () => {
    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, items: [{ workerId: WORKER_ID, amount: 0 }] });
    expect(res.status).toBe(400);
  });
});

describe('POST /payouts/batch — execution and result aggregation', () => {
  it('all items succeed → status completed, 201', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.sendPayment).mockResolvedValue('tx-batch-item-1');

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, currency: 'XLM', items: [{ workerId: WORKER_ID, amount: 1 }] });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('completed');
    expect(res.body.completedCount).toBe(1);
    expect(res.body.failedCount).toBe(0);
    expect(stellar.sendPayment).toHaveBeenCalledTimes(1);
  });

  it('a partial failure → status partial, 207', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, NO_EXISTING_BATCH, BATCH_INSERT_OK, HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]),
    );
    // First item succeeds, second fails.
    vi.mocked(stellar.sendPayment).mockResolvedValueOnce('tx-ok').mockRejectedValueOnce(new Error('tx_failed'));

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({
        enterpriseId: ENTERPRISE_ID, currency: 'XLM',
        items: [{ workerId: WORKER_ID, amount: 1 }, { workerId: WORKER_ID, amount: 2 }],
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
      .send({ enterpriseId: ENTERPRISE_ID, currency: 'XLM', items: [{ workerId: WORKER_ID, amount: 1 }], idempotencyKey: 'batch-key-1' });

    expect(res.status).toBe(422);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });

  it('idempotency: a batch already processing under the same key is rejected (409)', async () => {
    const items = [{ workerId: WORKER_ID, amount: 1 }];
    const matchingHash = crypto.createHash('sha256')
      .update(JSON.stringify({ asset: 'XLM', items: [{ workerId: WORKER_ID, amountNum: 1, memo: undefined }] }))
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
      .send({ enterpriseId: ENTERPRISE_ID, currency: 'XLM', items, idempotencyKey: 'batch-key-1' });

    expect(res.status).toBe(409);
  });

  it('idempotency: a terminal batch under the same key replays from payments ground truth, no re-execution', async () => {
    const items = [{ workerId: WORKER_ID, amount: 1 }];
    const matchingHash = crypto.createHash('sha256')
      .update(JSON.stringify({ asset: 'XLM', items: [{ workerId: WORKER_ID, amountNum: 1, memo: undefined }] }))
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
          handler: () => ({ rows: [{ paymentId: 'p1', workerId: WORKER_ID, amount: '1.00', currency: 'XLM', status: 'completed', stellarTxHash: 'cached-tx', sourceAmountXlm: null }] }),
        },
      ]),
    );

    const res = await request(app)
      .post('/payouts/batch')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, currency: 'XLM', items, idempotencyKey: 'batch-key-1' });

    expect(res.status).toBe(201);
    expect(res.body.batchId).toBe('batch-1');
    expect(res.body.results[0].stellarTxHash).toBe('cached-tx');
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });
});
