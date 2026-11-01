import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as db from '@funti3r/database';
import { verifyIdentity } from '@funti3r/shared-utils';
import * as stellar from '../lib/stellar.js';
import { reconcileStalePayments, scheduleRunHeaders } from '../scheduler.js';

describe('scheduleRunHeaders', () => {
  beforeAll(() => {
    process.env.INTERNAL_AUTH_SECRET ??= 'x'.repeat(32);
  });

  it('acts as the schedule owner, signed so the payout routes trust it', () => {
    const now = Date.now();
    const headers = scheduleRunHeaders('ent-1', now);
    expect(headers['x-user-id']).toBe('ent-1');
    expect(headers['x-user-role']).toBe('enterprise');
    expect(verifyIdentity(headers, now)).toBe(true);
  });

  it('cannot be reused as a different enterprise', () => {
    const now = Date.now();
    const headers = scheduleRunHeaders('ent-1', now);
    expect(verifyIdentity({ ...headers, 'x-user-id': 'ent-2' }, now)).toBe(false);
  });
});

describe('reconcileStalePayments', () => {
  const query = vi.mocked(db.query);
  const find = vi.mocked(stellar.findTransactionByMemoHash);
  const CREATED = new Date('2026-11-01T08:00:00Z');
  const staleRow = (id: string) => ({
    id, enterprise_id: 'ent-1', worker_id: 'wkr-1', amount: '5', currency: 'XLM', created_at: CREATED,
    enterprise_public_key: 'GSOURCE', worker_email: 'w@example.com',
  });
  const sqlAfterSelect = () => query.mock.calls.slice(1).map(([sql, params]) => ({ sql: String(sql), params }));
  const updates = () => sqlAfterSelect().filter((c) => c.sql.includes('UPDATE payments'));
  const notifications = () => sqlAfterSelect().filter((c) => c.sql.includes('INSERT INTO notifications'));

  beforeEach(() => {
    query.mockReset();
    find.mockReset();
  });

  it('looks at both crashed (initiated) and unanswered (submitted) payouts', async () => {
    query.mockResolvedValue({ rows: [] } as any);

    await reconcileStalePayments();

    expect(String(query.mock.calls[0][0])).toContain("p.status IN ('initiated', 'submitted')");
  });

  it('marks a stale payment completed when its transaction is on chain, and tells both sides', async () => {
    query.mockResolvedValueOnce({ rows: [staleRow('pay-1')] } as any).mockResolvedValue({ rows: [{ id: 'pay-1' }] } as any);
    find.mockResolvedValueOnce({ hash: 'tx-abc', claimable: false });

    await reconcileStalePayments();

    const memo = createHash('sha256').update('pay-1').digest();
    expect(find).toHaveBeenCalledWith('GSOURCE', memo, CREATED);
    expect(updates()).toEqual([{ sql: expect.stringContaining('SET status = $1::text'), params: ['completed', 'tx-abc', 'pay-1'] }]);
    expect(notifications().map((n) => n.params?.[1])).toEqual(['payment_completed', 'payment_received']);
  });

  it('marks it pending_claim when what landed was the claimable-balance fallback', async () => {
    query.mockResolvedValueOnce({ rows: [staleRow('pay-5')] } as any).mockResolvedValue({ rows: [{ id: 'pay-5' }] } as any);
    find.mockResolvedValueOnce({ hash: 'tx-cb', claimable: true });

    await reconcileStalePayments();

    expect(updates()[0].params).toEqual(['pending_claim', 'tx-cb', 'pay-5']);
  });

  it('marks it failed when nothing landed, so a same-key retry may pay', async () => {
    query.mockResolvedValueOnce({ rows: [staleRow('pay-2')] } as any).mockResolvedValue({ rows: [] } as any);
    find.mockResolvedValueOnce(null);

    await reconcileStalePayments();

    expect(updates()).toEqual([{ sql: expect.stringContaining("status = 'failed'"), params: ['pay-2'] }]);
    expect(notifications()).toEqual([]);
  });

  it('leaves the payment alone when the chain cannot be read', async () => {
    query.mockResolvedValueOnce({ rows: [staleRow('pay-4')] } as any);
    find.mockRejectedValueOnce(new Error('horizon down'));

    await reconcileStalePayments();

    expect(updates()).toEqual([]);
  });
});
