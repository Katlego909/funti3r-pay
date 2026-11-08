import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query } from '@funti3r/database';
import { lookupTransaction } from '../lib/stellar.js';
import { reconcileUnconfirmedCashouts } from '../lib/rampsSync.js';
import { createQueryMock } from './helpers.js';

const CASHOUT_ID = 'cashout-2222-2222-2222-222222222222';
const HASH = 'maybe-landed-hash';

const UNCONFIRMED = {
  match: /SELECT id, settlement_hash FROM cashouts/,
  handler: () => ({ rows: [{ id: CASHOUT_ID, settlement_hash: HASH }] }),
};
const calls = (re: RegExp) => vi.mocked(query).mock.calls.filter(([sql]) => re.test(sql));

beforeEach(() => {
  vi.mocked(query).mockReset().mockImplementation(createQueryMock([UNCONFIRMED]));
  vi.mocked(lookupTransaction).mockReset();
});

describe('reconcileUnconfirmedCashouts', () => {
  it('only looks at pending cash-outs whose time bound is over', async () => {
    vi.mocked(lookupTransaction).mockResolvedValue({ found: false });
    await reconcileUnconfirmedCashouts();
    const [sql] = calls(/SELECT id, settlement_hash FROM cashouts/)[0];
    expect(sql).toMatch(/status = 'pending'/);
    expect(sql).toMatch(/settlement_unconfirmed_since < NOW\(\) - INTERVAL '5 minutes'/);
  });

  it('confirms a payment that landed and leaves the cash-out for MoneyGram to complete', async () => {
    vi.mocked(lookupTransaction).mockResolvedValue({ found: true, successful: true, memoType: 'id' });
    await reconcileUnconfirmedCashouts();
    expect(calls(/SET settlement_unconfirmed_since = NULL WHERE id = \$1 AND settlement_hash = \$2/)[0][1]).toEqual([CASHOUT_ID, HASH]);
    expect(calls(/SET status = 'failed'/)).toHaveLength(0);
  });

  it('fails a payment that never landed and clears its hash, so the worker may retry', async () => {
    vi.mocked(lookupTransaction).mockResolvedValue({ found: false });
    await reconcileUnconfirmedCashouts();
    const [[sql, params]] = calls(/SET status = 'failed', settlement_hash = NULL/);
    expect(sql).toMatch(/WHERE id = \$1 AND status = 'pending' AND settlement_hash = \$2/);
    expect(params).toEqual([CASHOUT_ID, HASH, 'Not on chain after its time bound — safe to retry']);
  });

  it('fails a payment that landed unsuccessfully: nothing was paid', async () => {
    vi.mocked(lookupTransaction).mockResolvedValue({ found: true, successful: false, memoType: 'id' });
    await reconcileUnconfirmedCashouts();
    expect(calls(/SET status = 'failed', settlement_hash = NULL/)[0][1]![2]).toBe('Payment failed on chain — safe to retry');
  });

  it('never fails a cash-out without the chain\'s answer: a Horizon error leaves it for the next run', async () => {
    vi.mocked(lookupTransaction).mockRejectedValue(new Error('Horizon 503'));
    await reconcileUnconfirmedCashouts();
    expect(calls(/UPDATE cashouts/)).toHaveLength(0);
  });
});
