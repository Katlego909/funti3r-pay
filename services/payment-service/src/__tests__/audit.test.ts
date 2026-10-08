import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query } from '@funti3r/database';
import { runWithLogContext } from '@funti3r/shared-utils';
import { audit } from '../lib/audit.js';

beforeEach(() => {
  vi.mocked(query).mockReset().mockResolvedValue({ rows: [] } as never);
});

describe('audit trail', () => {
  it('writes who did what to which record, tagged with the request it happened in', async () => {
    await runWithLogContext({ requestId: 'req-42' }, () => audit({
      actorId: 'user-1', actorRole: 'worker', action: 'cashout.paid', entityType: 'cashout', entityId: 'c-1', detail: { usdc: '10' },
    }));
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toMatch(/INSERT INTO audit_events/);
    expect(params).toEqual(['user-1', 'worker', 'cashout.paid', 'cashout', 'c-1', JSON.stringify({ usdc: '10' }), 'req-42']);
  });

  it('works outside a request (a background job): no actor, no request id', async () => {
    await audit({ actorRole: 'system', action: 'payout.failed', entityType: 'payment', entityId: 'p-1' });
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([null, 'system', 'payout.failed', 'payment', 'p-1', null, null]);
  });

  it('never throws: money that already moved is not undone because the trail could not be written', async () => {
    vi.mocked(query).mockRejectedValue(new Error('database is down'));
    await expect(audit({ actorRole: 'worker', action: 'cashout.paid', entityType: 'cashout', entityId: 'c-2' })).resolves.toBeUndefined();
  });
});
