import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import app from '../app.js';
import { createQueryMock, WORKER_ID, ENTERPRISE_ID, HANDLER_NOT_ON_TEAM, HANDLER_WORKER_FOUND_BULK } from './helpers.js';

// Only the paying company's own workers can be paid: by a payout, a batch, a schedule or an escrow.
const owner = { 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' };
const SECRET = {
  match: /^SELECT stellar_secret_key FROM users/,
  handler: () => ({ rows: [{ stellar_secret_key: 'SENTERPRISESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }] }),
};
const BATCH_INSERT = { match: /INSERT INTO payment_batches/, handler: () => ({ rows: [{ id: 'batch-1' }] }) };
const schedule = { name: 'Payroll', frequency: 'monthly', runDay: '1', items: [{ workerId: WORKER_ID, amountUsd: 50 }] };

beforeEach(() => {
  vi.mocked(query).mockReset().mockImplementation(createQueryMock([HANDLER_NOT_ON_TEAM, SECRET, BATCH_INSERT, HANDLER_WORKER_FOUND_BULK]));
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
  vi.mocked(axios.post).mockReset().mockResolvedValue({ data: { statuses: { [WORKER_ID]: { status: 'verified' } } } });
  vi.mocked(stellar.sendPayment).mockReset();
  vi.mocked(stellar.payExactWithXlm).mockReset();
});

describe('payee must be on the team', () => {
  it('refuses a single payout to someone outside the company, before anything is sent', async () => {
    const res = await request(app).post('/payouts').set(owner).send({ workerId: WORKER_ID, amount: 5, currency: 'XLM' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not on your team/);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });

  it('fails a batch item for someone outside the company without paying them', async () => {
    const res = await request(app).post('/payouts/batch').set(owner).send({ items: [{ workerId: WORKER_ID, amountUsd: 5 }] });
    expect(res.status).toBe(207);
    expect(res.body.status).toBe('failed');
    expect(res.body.results[0].error).toMatch(/not on your team/);
    expect(stellar.payExactWithXlm).not.toHaveBeenCalled();
  });

  it('refuses a schedule that pays someone outside the company', async () => {
    const res = await request(app).post('/schedules').set(owner).send(schedule);
    expect(res.status).toBe(403);
  });
});

describe('POST /schedules validation', () => {
  it.each([
    ['a malformed worker id', { ...schedule, items: [{ workerId: 'nope', amountUsd: 5 }] }],
    ['a non-numeric amount', { ...schedule, items: [{ workerId: WORKER_ID, amountUsd: 'abc' }] }],
    ['an unknown frequency', { ...schedule, frequency: 'daily' }],
    ['more than 100 items', { ...schedule, items: Array.from({ length: 101 }, () => ({ workerId: WORKER_ID, amountUsd: 1 })) }],
  ])('400s on %s instead of a database error', async (_label, body) => {
    const res = await request(app).post('/schedules').set(owner).send(body);
    expect(res.status).toBe(400);
  });
});
