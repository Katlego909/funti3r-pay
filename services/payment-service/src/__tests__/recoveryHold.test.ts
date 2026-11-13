import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { query } from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import app from '../app.js';
import { recoveryHoldUntil, RECOVERY_HOLD_MS } from '../lib/recoveryHold.js';
import { createQueryMock, ENTERPRISE_ID, WORKER_ID } from './helpers.js';

const NOW = Date.parse('2026-11-13T12:00:00Z');

function recoveredAt(msAgo: number | null) {
  return {
    match: /SELECT recovered_at FROM users/,
    handler: () => ({ rows: [{ recovered_at: msAgo === null ? null : new Date(Date.now() - msAgo) }] }),
  };
}

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(stellar.sendPayment).mockReset();
  vi.mocked(stellar.payExactWithXlm).mockReset();
});

describe('recoveryHoldUntil', () => {
  it('is null for a user who never recovered by email', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ recovered_at: null }] } as any);
    expect(await recoveryHoldUntil(WORKER_ID, NOW)).toBeNull();
  });

  it('is null for an unknown user', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as any);
    expect(await recoveryHoldUntil(WORKER_ID, NOW)).toBeNull();
  });

  it('ends 48 hours after the recovery', async () => {
    const at = new Date(NOW - 60 * 60 * 1000);
    vi.mocked(query).mockResolvedValue({ rows: [{ recovered_at: at }] } as any);
    expect(await recoveryHoldUntil(WORKER_ID, NOW)).toEqual(new Date(at.getTime() + RECOVERY_HOLD_MS));
  });

  it('is null once the 48 hours have passed', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ recovered_at: new Date(NOW - RECOVERY_HOLD_MS - 1) }] } as any);
    expect(await recoveryHoldUntil(WORKER_ID, NOW)).toBeNull();
  });
});

const enterprise = { 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' };
const worker = { 'x-user-id': WORKER_ID, 'x-user-role': 'worker' };

// Every route that moves money out of the caller's account.
const GUARDED: Array<[string, string, Record<string, string>]> = [
  ['post', '/payouts', enterprise],
  ['post', '/payouts/batch', enterprise],
  ['post', '/escrows', enterprise],
  ['post', '/escrows/e1/milestones/0/approve', enterprise],
  ['post', '/schedules', enterprise],
  ['patch', '/schedules/s1', enterprise],
  ['post', '/cashouts/moneygram/session', worker],
  ['post', '/cashouts/moneygram/deposit', worker],
];

describe('money-out routes during a recovery hold', () => {
  it.each(GUARDED)('%s %s is refused within 48h of an email recovery', async (method, path, headers) => {
    vi.mocked(query).mockImplementation(createQueryMock([recoveredAt(60 * 60 * 1000)]));

    const res = await (request(app) as any)[method](path).set(headers).send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('recovery_hold');
    expect(stellar.sendPayment).not.toHaveBeenCalled();
    expect(stellar.payExactWithXlm).not.toHaveBeenCalled();
  });

  it.each(GUARDED)('%s %s is not held once the 48h have passed', async (method, path, headers) => {
    vi.mocked(query).mockImplementation(createQueryMock([recoveredAt(RECOVERY_HOLD_MS + 60_000)]));

    const res = await (request(app) as any)[method](path).set(headers).send({});

    expect(res.body.code).not.toBe('recovery_hold');
  });

  it('blocks the request when the hold cannot be checked', async () => {
    vi.mocked(query).mockRejectedValue(new Error('connection refused'));

    const res = await request(app).post('/payouts').set(enterprise).send({});

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
  });
});
