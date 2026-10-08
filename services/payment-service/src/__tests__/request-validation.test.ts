import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { query } from '@funti3r/database';
import app from '../app.js';
import { createQueryMock, ENTERPRISE_ID, WORKER_ID } from './helpers.js';

const enterprise = { 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' };
const worker = { 'x-user-id': WORKER_ID, 'x-user-role': 'worker' };

beforeEach(() => {
  vi.mocked(query).mockReset().mockImplementation(createQueryMock([]));
});

describe('request bodies are checked before any handler or database sees them', () => {
  it('POST /payouts: an id that is not a UUID is a 400 naming the field (not a database error)', async () => {
    const res = await request(app).post('/payouts').set(enterprise).send({ workerId: "1'; DROP TABLE users;--", amountUsd: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/workerId/);
    expect(res.body.issues[0].path).toBe('workerId');
  });

  it('POST /payouts: oversized memo and idempotency key are refused', async () => {
    expect((await request(app).post('/payouts').set(enterprise).send({ workerId: WORKER_ID, amountUsd: 5, memo: 'x'.repeat(201) })).status).toBe(400);
    expect((await request(app).post('/payouts').set(enterprise).send({ workerId: WORKER_ID, amountUsd: 5, idempotencyKey: 'k'.repeat(129) })).status).toBe(400);
  });

  it('permission checks come first: someone who may not pay anyone gets a 403 whatever they send', async () => {
    const res = await request(app).post('/payouts').set(worker).send({ workerId: 'garbage' });
    expect(res.status).toBe(403);
  });

  it('POST /payouts/batch: a malformed item id is a 400, and the array is bounded', async () => {
    expect((await request(app).post('/payouts/batch').set(enterprise).send({ items: [{ workerId: 'nope', amountUsd: 1 }] })).status).toBe(400);
    const huge = Array.from({ length: 1001 }, () => ({ workerId: WORKER_ID, amountUsd: 1 }));
    expect((await request(app).post('/payouts/batch').set(enterprise).send({ items: huge })).status).toBe(400);
  });

  it('POST /escrows: too many milestones, a bad worker id or a missing expiry are refused', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const many = Array.from({ length: 51 }, () => ({ amountXlm: 1 }));
    expect((await request(app).post('/escrows').set(enterprise).send({ workerId: WORKER_ID, milestones: many, expiresAt })).status).toBe(400);
    expect((await request(app).post('/escrows').set(enterprise).send({ workerId: 'x', milestones: [{ amountXlm: 1 }], expiresAt })).status).toBe(400);
    expect((await request(app).post('/escrows').set(enterprise).send({ workerId: WORKER_ID, milestones: [{ amountXlm: 1 }] })).status).toBe(400);
  });
});
