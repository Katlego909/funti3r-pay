import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import app, { payoutPayloadHash } from '../app.js';
import { createQueryMock, WORKER_ID, ENTERPRISE_ID, ADMIN_ID, MEMBER_ID, WORKER_ROW, HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT } from './helpers.js';

const ENTERPRISE_SECRET_HANDLER = {
  match: /^SELECT stellar_secret_key FROM users/,
  handler: () => ({ rows: [{ stellar_secret_key: 'SENTERPRISESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }] }),
};

const enterpriseHeaders = { 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' };

beforeEach(() => {
  vi.mocked(query).mockReset();
  // Default: ENTERPRISE_ID resolves as its own company's owner — every test
  // below that doesn't override this keeps the pre-Phase-2 behavior where the
  // requester IS the enterprise identity being scoped by.
  vi.mocked(query).mockImplementation(createQueryMock([]));
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
  vi.mocked(stellar.sendPayment).mockReset();
  vi.mocked(stellar.payExactWithXlm).mockReset();
});

describe('POST /payouts — authorization', () => {
  it('403s when the requester role is not enterprise', async () => {
    const res = await request(app)
      .post('/payouts')
      .set({ 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'worker' })
      .send({ enterpriseId: ENTERPRISE_ID, workerId: WORKER_ID, amount: 5, currency: 'XLM' });

    expect(res.status).toBe(403);
  });

  it('403s when requester is a company member (not owner/admin) — money movement is owner/admin-only', async () => {
    const res = await request(app)
      .post('/payouts')
      .set({ 'x-user-id': MEMBER_ID, 'x-user-role': 'enterprise' })
      .send({ workerId: WORKER_ID, amount: 5, currency: 'XLM' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owners and admins/);
  });

  it('admin can send a payment on behalf of the company', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.sendPayment).mockResolvedValue('tx-admin-send');

    const res = await request(app)
      .post('/payouts')
      .set({ 'x-user-id': ADMIN_ID, 'x-user-role': 'enterprise' })
      .send({ workerId: WORKER_ID, amount: 5, currency: 'XLM' });

    expect(res.status).toBe(201);
    expect(res.body.stellarTxHash).toBe('tx-admin-send');
  });

  it('400s when workerId is missing', async () => {
    const res = await request(app)
      .post('/payouts')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, amount: 5, currency: 'XLM' });

    expect(res.status).toBe(400);
  });
});

describe('POST /payouts — validation', () => {
  it('exact mode: 400 on non-positive amount', async () => {
    const res = await request(app)
      .post('/payouts')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, workerId: WORKER_ID, amount: -5, currency: 'XLM' });

    expect(res.status).toBe(400);
  });

  it('exact mode: 400 on unsupported currency', async () => {
    const res = await request(app)
      .post('/payouts')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, workerId: WORKER_ID, amount: 5, currency: 'ZZZ' });

    expect(res.status).toBe(400);
  });

  it('USD mode: 400 on non-positive amountUsd', async () => {
    const res = await request(app)
      .post('/payouts')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, workerId: WORKER_ID, amountUsd: 0 });

    expect(res.status).toBe(400);
  });

  it('USD mode: converts via the worker preferred currency (USDC, rate 1:1) and succeeds', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([
        ENTERPRISE_SECRET_HANDLER,
        { match: /SELECT preferred_currency/, handler: () => ({ rows: [{ preferred_currency: 'USDC' }] }) },
        HANDLER_WORKER_FOUND,
        HANDLER_INSERT_PAYMENT,
      ]),
    );
    vi.mocked(stellar.payExactWithXlm).mockResolvedValue({ hash: 'tx-usd-mode', sourceAmountXlm: '2.5' });

    const res = await request(app)
      .post('/payouts')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, workerId: WORKER_ID, amountUsd: 10 });

    expect(res.status).toBe(201);
    expect(res.body.usdAmount).toBe(10);
  });

  it('400s when the enterprise has no Stellar account set up', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([{ match: /^SELECT stellar_secret_key FROM users/, handler: () => ({ rows: [] }) }]),
    );

    const res = await request(app)
      .post('/payouts')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, workerId: WORKER_ID, amount: 5, currency: 'XLM' });

    expect(res.status).toBe(400);
  });
});

describe('POST /payouts — success and failure mapping', () => {
  it('201s on success with the Stellar tx hash', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([ENTERPRISE_SECRET_HANDLER, HANDLER_WORKER_FOUND, HANDLER_INSERT_PAYMENT]),
    );
    vi.mocked(stellar.sendPayment).mockResolvedValue('tx-hash-route-success');

    const res = await request(app)
      .post('/payouts')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, workerId: WORKER_ID, amount: 5, currency: 'XLM' });

    expect(res.status).toBe(201);
    expect(res.body.stellarTxHash).toBe('tx-hash-route-success');
  });

  it('maps an explicit httpStatus from executePayout (idempotency 409) over the regex inference', async () => {
    const KEY = 'route-conflict-key';
    const matchingHash = payoutPayloadHash(WORKER_ID, 5, 'XLM');
    vi.mocked(query).mockImplementation(
      createQueryMock([
        ENTERPRISE_SECRET_HANDLER,
        {
          match: /idempotency_key = \$2/,
          handler: () => ({ rows: [{ id: 'p1', status: 'initiated', payload_hash: matchingHash }] }),
        },
      ]),
    );

    const res = await request(app)
      .post('/payouts')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, workerId: WORKER_ID, amount: 5, currency: 'XLM', idempotencyKey: KEY });

    expect(res.status).toBe(409);
  });

  it('maps a "not found" error message to 404', async () => {
    vi.mocked(query).mockImplementation(
      createQueryMock([
        ENTERPRISE_SECRET_HANDLER,
        { match: /SELECT stellar_public_key, stellar_secret_key, email/, handler: () => ({ rows: [] }) },
      ]),
    );

    // Worker lookup returns nothing → "Worker Stellar account not found" (matches /not found/i).
    const res = await request(app)
      .post('/payouts')
      .set(enterpriseHeaders)
      .send({ enterpriseId: ENTERPRISE_ID, workerId: WORKER_ID, amount: 5, currency: 'XLM' });

    expect(res.status).toBe(404);
  });
});
