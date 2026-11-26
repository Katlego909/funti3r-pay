import { describe, it, expect } from 'vitest';
import { batchVerdict, isMoneyMoved } from '../lib/paymentStatus.js';

describe('isMoneyMoved', () => {
  it('counts a claimable balance as money moved, and nothing in flight or failed', () => {
    expect(['completed', 'pending_claim'].every(isMoneyMoved)).toBe(true);
    expect(['failed', 'initiated', 'submitted'].some(isMoneyMoved)).toBe(false);
  });
});

describe('batchVerdict', () => {
  it('a claimable balance next to a failure is partial, not failed: money moved', () => {
    expect(batchVerdict(['pending_claim', 'failed'])).toMatchObject({
      status: 'partial', movedCount: 1, failedCount: 1, pendingClaimCount: 1,
    });
  });

  it('only claimable balances is completed, with every payment counted as sent', () => {
    expect(batchVerdict(['pending_claim', 'pending_claim'])).toMatchObject({ status: 'completed', movedCount: 2 });
  });

  it('stays processing while any payment awaits the chain', () => {
    expect(batchVerdict(['completed', 'submitted', 'failed']).status).toBe('processing');
  });

  it('counts items a crash never recorded as not paid', () => {
    expect(batchVerdict(['completed'], 3)).toMatchObject({ status: 'partial', movedCount: 1, failedCount: 2 });
    expect(batchVerdict([], 2)).toMatchObject({ status: 'failed', failedCount: 2 });
  });
});
