import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as escrow from '../lib/escrow.js';
import * as stellar from '../lib/stellar.js';
import app from '../app.js';
import { settleEscrowCreations } from '../lib/escrowCreation.js';
import { createQueryMock, WORKER_ID, ENTERPRISE_ID } from './helpers.js';

// Creating an escrow locks the employer's money: it must never be locked without a record, nor locked twice.
const owner = { 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' };
const CREATION_ID = '77777777-7777-4777-8777-777777777777';
const ESCROW_ID = '88888888-8888-4888-8888-888888888888';
const body = (extra: Record<string, unknown> = {}) => ({
  workerId: WORKER_ID, milestones: [{ amountXlm: 10 }], expiresAt: new Date(Date.now() + 86_400_000).toISOString(), ...extra,
});

const WORKER = {
  match: /SELECT stellar_public_key, email FROM users WHERE id = \$1 AND role = 'worker'/,
  handler: () => ({ rows: [{ stellar_public_key: 'GDESTWORKERPUBLICKEYXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', email: 'w@test.com' }] }),
};
const SECRET = {
  match: /^SELECT stellar_secret_key FROM users/,
  handler: () => ({ rows: [{ stellar_secret_key: 'SFAKESECRETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }] }),
};
const PENDING_ROW = {
  id: CREATION_ID, enterprise_id: ENTERPRISE_ID, worker_id: WORKER_ID, contract_address: 'CESCROW',
  milestones: [{ amountXlm: '10' }], expires_at: new Date(), status: 'pending', escrow_id: null,
};
const handlers = [
  WORKER, SECRET,
  { match: /INSERT INTO escrow_creations/, handler: () => ({ rows: [{ id: CREATION_ID }] }) },
  { match: /SELECT \* FROM escrow_creations WHERE id = \$1 FOR UPDATE/, handler: () => ({ rows: [PENDING_ROW] }) },
  { match: /INSERT INTO escrows/, handler: () => ({ rows: [{ id: ESCROW_ID }] }) },
];
const sqlCalls = () => vi.mocked(query).mock.calls.map(([sql]) => String(sql));
const failedCreation = () => sqlCalls().some((s) => /UPDATE escrow_creations SET status = 'failed'/.test(s));

beforeEach(() => {
  vi.mocked(query).mockReset().mockImplementation(createQueryMock(handlers));
  vi.mocked(escrow.createEscrow).mockReset();
  vi.mocked(escrow.contractCallOutcome).mockReset();
  vi.mocked(stellar.sendPayment).mockReset();
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
});

describe('POST /escrows write-ahead', () => {
  it('records the creation before signing, and hands the chain call a hook that stores its hash', async () => {
    vi.mocked(escrow.createEscrow).mockImplementation(async (...args) => {
      expect(sqlCalls().some((s) => /INSERT INTO escrow_creations/.test(s))).toBe(true);
      expect(typeof args[4]).toBe('function');
      return { escrowId: 3n, hash: 'tx-create' };
    });
    const res = await request(app).post('/escrows').set(owner).send(body());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: ESCROW_ID, onchainEscrowId: '3' });
  });

  it('answers 202 and keeps the creation pending when the chain gave no verdict: the money may be locked', async () => {
    vi.mocked(escrow.createEscrow).mockRejectedValue(new stellar.SubmitOutcomeUnknownError('tx-unknown', new Error('timeout')));
    const res = await request(app).post('/escrows').set(owner).send(body());
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ creationId: CREATION_ID, status: 'submitted', txHash: 'tx-unknown' });
    expect(failedCreation()).toBe(false);
  });

  it('answers 202 when the escrow landed but its rows could not be written; the reconciler writes them', async () => {
    vi.mocked(escrow.createEscrow).mockResolvedValue({ escrowId: 3n, hash: 'tx-create' });
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /INSERT INTO escrows/, handler: () => { throw new Error('connection lost'); } }, ...handlers,
    ]));
    const res = await request(app).post('/escrows').set(owner).send(body());
    expect(res.status).toBe(202);
    expect(failedCreation()).toBe(false);
  });

  it('fails the creation when nothing landed, so a retry may sign again', async () => {
    vi.mocked(escrow.createEscrow).mockRejectedValue(new escrow.EscrowContractError(4, 'create'));
    const res = await request(app).post('/escrows').set(owner).send(body());
    expect(res.status).toBe(409);
    expect(failedCreation()).toBe(true);
  });

  // A fixed expiry (whole seconds, as the route stores it), so a request's payload hash is the same every time.
  const EXPIRES = '2030-01-01T00:00:00.000Z';
  const KEY = 'key-1';
  /** The payload hash the first request with KEY stored, read off its INSERT. */
  async function storedHash(): Promise<string> {
    vi.mocked(escrow.createEscrow).mockResolvedValueOnce({ escrowId: 3n, hash: 'tx-create' });
    await request(app).post('/escrows').set(owner).send(body({ idempotencyKey: KEY, expiresAt: EXPIRES }));
    const insert = vi.mocked(query).mock.calls.find(([sql]) => /INSERT INTO escrow_creations/.test(String(sql)));
    const hash = (insert?.[1] as unknown[])[6] as string;
    vi.mocked(query).mockClear();
    vi.mocked(escrow.createEscrow).mockReset();
    return hash;
  }
  const withExisting = (row: Record<string, unknown>) => vi.mocked(query).mockImplementation(createQueryMock([
    { match: /FROM escrow_creations c LEFT JOIN escrows/, handler: () => ({ rows: [row] }) }, ...handlers,
  ]));

  it('replays a finished creation with the same key instead of locking the money twice', async () => {
    const payload_hash = await storedHash();
    withExisting({ id: CREATION_ID, status: 'done', payload_hash, escrow_id: ESCROW_ID, onchain_escrow_id: '3', create_tx_hash: 'tx-create' });
    const res = await request(app).post('/escrows').set(owner).send(body({ idempotencyKey: KEY, expiresAt: EXPIRES }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: ESCROW_ID, onchainEscrowId: '3', replayed: true });
    expect(escrow.createEscrow).not.toHaveBeenCalled();
  });

  it('answers 409 while a creation with the same key is still waiting for the chain', async () => {
    const payload_hash = await storedHash();
    withExisting({ id: CREATION_ID, status: 'pending', payload_hash });
    const res = await request(app).post('/escrows').set(owner).send(body({ idempotencyKey: KEY, expiresAt: EXPIRES }));
    expect(res.status).toBe(409);
    expect(escrow.createEscrow).not.toHaveBeenCalled();
  });

  it('refuses a key reused for a different escrow', async () => {
    withExisting({ id: CREATION_ID, status: 'done', payload_hash: 'a-different-request' });
    const res = await request(app).post('/escrows').set(owner).send(body({ idempotencyKey: KEY, expiresAt: EXPIRES }));
    expect(res.status).toBe(422);
    expect(escrow.createEscrow).not.toHaveBeenCalled();
  });
});

describe('settleEscrowCreations', () => {
  const stale = (rows: Array<{ id: string; tx_hash: string | null }>) =>
    ({ match: /SELECT id, tx_hash FROM escrow_creations/, handler: () => ({ rows }) });

  it('records an escrow the chain confirmed, from its return value', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([stale([{ id: CREATION_ID, tx_hash: 'tx-1' }]), ...handlers]));
    vi.mocked(escrow.contractCallOutcome).mockResolvedValue({ found: true, successful: true, returnValue: 5n });
    expect(await settleEscrowCreations()).toEqual({ completed: 1, failed: 0 });
    const ins = vi.mocked(query).mock.calls.find(([sql]) => /INSERT INTO escrows/.test(String(sql)));
    expect((ins?.[1] as unknown[])[3]).toBe('5');
  });

  it('fails a creation the chain never saw, and one that was never signed', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([stale([{ id: 'a', tx_hash: 'tx-gone' }, { id: 'b', tx_hash: null }]), ...handlers]));
    vi.mocked(escrow.contractCallOutcome).mockResolvedValue({ found: false });
    expect(await settleEscrowCreations()).toEqual({ completed: 0, failed: 2 });
  });

  it('leaves the creation pending when the RPC cannot answer', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([stale([{ id: CREATION_ID, tx_hash: 'tx-1' }]), ...handlers]));
    vi.mocked(escrow.contractCallOutcome).mockRejectedValue(new Error('rpc down'));
    expect(await settleEscrowCreations()).toEqual({ completed: 0, failed: 0 });
    expect(failedCreation()).toBe(false);
  });
});
