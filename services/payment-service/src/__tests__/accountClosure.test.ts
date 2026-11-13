import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import app from '../app.js';
import { closureBlockers } from '../lib/accountClosure.js';
import { createQueryMock, WORKER_ID, ENTERPRISE_ID } from './helpers.js';

function counts(c: Partial<Record<'escrows' | 'payments' | 'cashouts' | 'schedules', number>>) {
  return {
    match: /SELECT COUNT\(\*\) FROM escrows/,
    handler: () => ({ rows: [{ escrows: '0', payments: '0', cashouts: '0', schedules: '0', ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) }] }),
  };
}
const withAccount = {
  match: /^SELECT stellar_public_key FROM users WHERE id = \$1$/,
  handler: () => ({ rows: [{ stellar_public_key: 'GWORKER' }] }),
};

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(stellar.balancesHeld).mockReset().mockResolvedValue([]);
});

describe('closureBlockers', () => {
  it('is empty when nothing is held, owed or on its way', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([withAccount, counts({})]));
    expect(await closureBlockers(WORKER_ID)).toEqual([]);
  });

  it('lists money in the wallet, open escrows, unsettled payments, pending cash-outs and active payroll', async () => {
    vi.mocked(stellar.balancesHeld).mockResolvedValue([{ asset: 'USDC', amount: 12.5 }]);
    vi.mocked(query).mockImplementation(createQueryMock([withAccount, counts({ escrows: 1, payments: 2, cashouts: 1, schedules: 3 })]));

    const blockers = await closureBlockers(WORKER_ID);

    expect(blockers).toHaveLength(5);
    expect(blockers[0]).toMatch(/12\.5 USDC/);
    expect(blockers.join(' ')).toMatch(/1 escrow.*2 payment.*1 cash-out.*3 payroll/);
  });

  it('skips the wallet for a user with no Stellar account', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([counts({})]));
    expect(await closureBlockers(ENTERPRISE_ID)).toEqual([]);
    expect(stellar.balancesHeld).not.toHaveBeenCalled();
  });
});

describe('GET /wallets/me/closure-check', () => {
  it('answers for the caller', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([withAccount, counts({ schedules: 1 })]));
    const res = await request(app).get('/wallets/me/closure-check').set({ 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' });
    expect(res.status).toBe(200);
    expect(res.body.blockers).toHaveLength(1);
  });

  it('needs an identity', async () => {
    const res = await request(app).get('/wallets/me/closure-check');
    expect(res.status).toBe(401);
  });
});

describe('a closed account is not a payee', () => {
  it('POST /payouts to a closed worker finds no worker and sends nothing', async () => {
    vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
    // The real query filters closed users out; the mock honours that filter only if the code asks for it.
    vi.mocked(query).mockImplementation(createQueryMock([
      {
        match: /^SELECT stellar_secret_key FROM users/,
        handler: () => ({ rows: [{ stellar_secret_key: 'SENTERPRISESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }] }),
      },
      { match: /SELECT stellar_public_key, stellar_secret_key, email FROM users/, handler: () => ({ rows: [] }) },
    ]));

    const res = await request(app)
      .post('/payouts')
      .set({ 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' })
      .send({ workerId: WORKER_ID, amount: 5, currency: 'XLM' });

    expect(res.status).toBe(404);
    expect(stellar.sendPayment).not.toHaveBeenCalled();
    const lookup = vi.mocked(query).mock.calls.find(([sql]) => /SELECT stellar_public_key, stellar_secret_key, email FROM users/.test(sql));
    expect(lookup?.[0]).toMatch(/status IS DISTINCT FROM 'closed'/);
  });
});
