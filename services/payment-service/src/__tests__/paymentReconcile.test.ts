import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as db from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import { verifyRecentPayments } from '../lib/paymentReconcile.js';

const query = vi.mocked(db.query);
const lookup = vi.mocked(stellar.lookupTransaction);
const memoOf = (id: string) => createHash('sha256').update(id).digest('base64');
const paid = (...rows: Array<{ id: string; stellar_tx_hash: string | null; rail?: string }>) =>
  query.mockResolvedValueOnce({ rows: rows.map((r) => ({ rail: 'stellar', ...r })) } as any);

beforeEach(() => {
  query.mockReset();
  lookup.mockReset();
});

describe('verifyRecentPayments', () => {
  it('accepts a payment backed by its own successful transaction', async () => {
    paid({ id: 'pay-ok', stellar_tx_hash: 'tx-ok' });
    lookup.mockResolvedValueOnce({ found: true, successful: true, memoType: 'hash', memo: memoOf('pay-ok') });
    expect(await verifyRecentPayments()).toEqual([]);
  });

  it('flags every way the chain can disagree', async () => {
    paid(
      { id: 'pay-nohash', stellar_tx_hash: null },
      { id: 'pay-missing', stellar_tx_hash: 'tx-missing' },
      { id: 'pay-failed', stellar_tx_hash: 'tx-failed' },
      { id: 'pay-other', stellar_tx_hash: 'tx-other' },
    );
    lookup
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({ found: true, successful: false, memoType: 'hash', memo: memoOf('pay-failed') })
      .mockResolvedValueOnce({ found: true, successful: true, memoType: 'hash', memo: memoOf('someone-else') });

    const found = await verifyRecentPayments();
    expect(found.map((d) => [d.paymentId, d.reason])).toEqual([
      ['pay-nohash', 'no transaction recorded'],
      ['pay-missing', 'transaction not on chain'],
      ['pay-failed', 'transaction failed on chain'],
      ['pay-other', 'transaction belongs to another payment'],
    ]);
  });

  it('accepts an escrow claim row without a memo (contract calls carry none)', async () => {
    paid({ id: 'pay-escrow', stellar_tx_hash: 'tx-claim', rail: 'escrow' });
    lookup.mockResolvedValueOnce({ found: true, successful: true, memoType: 'none' });
    expect(await verifyRecentPayments()).toEqual([]);
  });

  it('still flags an escrow claim row whose transaction is missing', async () => {
    paid({ id: 'pay-escrow', stellar_tx_hash: 'tx-gone', rail: 'escrow' });
    lookup.mockResolvedValueOnce({ found: false });
    expect((await verifyRecentPayments()).map((d) => d.reason)).toEqual(['transaction not on chain']);
  });

  it('skips a payment it cannot check instead of flagging it', async () => {
    paid({ id: 'pay-x', stellar_tx_hash: 'tx-x' });
    lookup.mockRejectedValueOnce(new Error('horizon down'));
    expect(await verifyRecentPayments()).toEqual([]);
  });

  it('never writes to the database', async () => {
    paid({ id: 'pay-missing', stellar_tx_hash: 'tx-missing' });
    lookup.mockResolvedValueOnce({ found: false });
    await verifyRecentPayments();
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toMatch(/^\s*SELECT/);
  });
});
