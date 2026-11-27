import { describe as group, expect, it } from 'vitest';
import { describe } from './auditText';

group('audit events in words', () => {
  it('names the people instead of ids, and keeps the reason and the transaction apart', () => {
    expect(describe({ action: 'payout.completed', worker_email: 'w@x.io', detail: { amount: 4097.869791, currency: 'NGN', txHash: 'ab'.repeat(32) } }))
      .toEqual({ summary: 'Paid 4,097.869791 NGN to w@x.io', reason: undefined, txHash: 'ab'.repeat(32) });
    expect(describe({ action: 'account.suspended', entity_email: 'w@x.io', detail: { reason: 'Fraud report', from: 'active', to: 'suspended' } }))
      .toEqual({ summary: 'Suspended w@x.io', reason: 'Fraud report', txHash: undefined });
    expect(describe({ action: 'escrow.created', detail: { total: 2, tokenCode: 'USDC', milestones: 1, workerId: 'fa1714c8-e1a8-40b1-8801-2be113f08766' } }).summary)
      .toBe('Locked 2 USDC in escrow for worker fa1714c8…8766 (1 milestone)');
  });

  it('still reads an action it does not know', () => {
    expect(describe({ action: 'escrow.something_new', detail: { checkedCount: 3, reason: 'x' } }))
      .toEqual({ summary: 'Escrow something new (checked count: 3)', reason: 'x', txHash: undefined });
  });
});
