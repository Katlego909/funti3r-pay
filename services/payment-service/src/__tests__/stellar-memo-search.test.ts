import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { Horizon } from '@stellar/stellar-sdk';

// setup.ts replaces lib/stellar.js for the route tests; here the real lookup is the unit under test, with Horizon's
// call builders stubbed on the SDK prototype (the module builds its Horizon.Server at load time).
const EMPLOYER = 'GEMPLOYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const WORKER = 'GWORKERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const memoHash = crypto.createHash('sha256').update('payment-1').digest();
const since = new Date('2026-11-01T00:00:00Z');

let records: Array<Record<string, unknown>> = [];
const page = () => ({ records, next: async () => ({ records: [], next: async () => ({ records: [] }) }) });

vi.spyOn(Horizon.Server.prototype, 'transactions').mockImplementation(() => ({
  forAccount: () => ({ order: () => ({ limit: () => ({ call: async () => page() }) }) }),
}) as never);
vi.spyOn(Horizon.Server.prototype, 'operations').mockImplementation(() => ({
  forTransaction: () => ({ call: async () => ({ records: [{ type: 'payment' }] }) }),
}) as never);

const { findTransactionByMemoHash } = await vi.importActual<typeof import('../lib/stellar.js')>('../lib/stellar.js');

const tx = (source: string, hash: string) => ({
  hash, source_account: source, memo_type: 'hash', memo: memoHash.toString('base64'), created_at: '2026-11-20T00:00:00Z',
});

beforeEach(() => { records = []; });

describe('findTransactionByMemoHash', () => {
  it('finds the payout the account itself signed', async () => {
    records = [tx(EMPLOYER, 'paid')];
    expect(await findTransactionByMemoHash(EMPLOYER, memoHash, since)).toEqual({ hash: 'paid', claimable: false });
  });

  it('ignores a transaction someone else sent TO the account with the same memo', async () => {
    records = [tx(WORKER, 'spoof')];
    expect(await findTransactionByMemoHash(EMPLOYER, memoHash, since)).toBeNull();
  });
});
