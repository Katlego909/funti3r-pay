import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as db from '@funti3r/database';
import * as stellar from '../lib/stellar.js';
import { reconcileStalePayments, runDueSchedules } from '../scheduler.js';

vi.mock('../app.js', () => ({ runBatchPayout: vi.fn() }));
const { runBatchPayout } = await import('../app.js');

describe('reconcileStalePayments', () => {
  const query = vi.mocked(db.query);
  const find = vi.mocked(stellar.findTransactionByMemoHash);
  const outcome = vi.mocked(stellar.payoutOutcome);
  const CREATED = new Date('2026-11-01T08:00:00Z');
  const staleRow = (id: string, stellar_tx_hash: string | null = null) => ({
    id, enterprise_id: 'ent-1', worker_id: 'wkr-1', amount: '5', currency: 'XLM', created_at: CREATED, stellar_tx_hash,
    enterprise_public_key: 'GSOURCE', worker_email: 'w@example.com',
  });
  const sqlAfterSelect = () => query.mock.calls.slice(1).map(([sql, params]) => ({ sql: String(sql), params }));
  const updates = () => sqlAfterSelect().filter((c) => c.sql.includes('UPDATE payments'));
  const notifications = () => sqlAfterSelect().filter((c) => c.sql.includes('INSERT INTO notifications'));

  beforeEach(() => {
    query.mockReset();
    find.mockReset();
    outcome.mockReset();
  });

  it('waits for a signed transaction\'s time bound, and gives unsigned rows a few minutes', async () => {
    query.mockResolvedValue({ rows: [] } as any);

    await reconcileStalePayments();

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("p.status IN ('initiated', 'submitted')");
    expect(sql).toMatch(/p\.tx_max_time < NOW\(\) - INTERVAL '2 minutes'/);
    expect(sql).toMatch(/ELSE p\.updated_at < NOW\(\) - INTERVAL '5 minutes'/);
  });

  it('settles a row with a stored hash from that one transaction, without the memo search', async () => {
    query.mockResolvedValueOnce({ rows: [staleRow('pay-9', 'tx-stored')] } as any).mockResolvedValue({ rows: [{ id: 'pay-9' }] } as any);
    outcome.mockResolvedValueOnce({ found: true, successful: true, claimable: false });

    await reconcileStalePayments();

    expect(outcome).toHaveBeenCalledWith('tx-stored');
    expect(find).not.toHaveBeenCalled();
    expect(updates()[0].params).toEqual(['completed', 'tx-stored', 'pay-9', 'tx-stored']);
  });

  it('fails a row whose stored transaction landed but failed, guarded on that hash', async () => {
    query.mockResolvedValueOnce({ rows: [staleRow('pay-8', 'tx-bad')] } as any).mockResolvedValue({ rows: [] } as any);
    outcome.mockResolvedValueOnce({ found: true, successful: false, claimable: false });

    await reconcileStalePayments();

    expect(updates()).toEqual([{ sql: expect.stringContaining("status = 'failed'"), params: ['pay-8', 'tx-bad'] }]);
    expect(updates()[0].sql).toContain('stellar_tx_hash IS NOT DISTINCT FROM $2');
  });

  it('marks a stale payment completed when its transaction is on chain, and tells both sides', async () => {
    query.mockResolvedValueOnce({ rows: [staleRow('pay-1')] } as any).mockResolvedValue({ rows: [{ id: 'pay-1' }] } as any);
    find.mockResolvedValueOnce({ hash: 'tx-abc', claimable: false });

    await reconcileStalePayments();

    const memo = createHash('sha256').update('pay-1').digest();
    expect(find).toHaveBeenCalledWith('GSOURCE', memo, CREATED);
    expect(updates()).toEqual([{ sql: expect.stringContaining('SET status = $1::text'), params: ['completed', 'tx-abc', 'pay-1', null] }]);
    expect(notifications().map((n) => n.params?.[1])).toEqual(['payment_completed', 'payment_received']);
  });

  it('marks it pending_claim when what landed was the claimable-balance fallback', async () => {
    query.mockResolvedValueOnce({ rows: [staleRow('pay-5')] } as any).mockResolvedValue({ rows: [{ id: 'pay-5' }] } as any);
    find.mockResolvedValueOnce({ hash: 'tx-cb', claimable: true });

    await reconcileStalePayments();

    expect(updates()[0].params).toEqual(['pending_claim', 'tx-cb', 'pay-5', null]);
  });

  it('marks it failed when nothing landed, so a same-key retry may pay', async () => {
    query.mockResolvedValueOnce({ rows: [staleRow('pay-2')] } as any).mockResolvedValue({ rows: [] } as any);
    find.mockResolvedValueOnce(null);

    await reconcileStalePayments();

    expect(updates()).toEqual([{ sql: expect.stringContaining("status = 'failed'"), params: ['pay-2', null] }]);
    expect(notifications()).toEqual([]);
  });

  it('leaves the payment alone when the chain cannot be read', async () => {
    query.mockResolvedValueOnce({ rows: [staleRow('pay-4', 'tx-x')] } as any);
    outcome.mockRejectedValueOnce(new Error('horizon down'));

    await reconcileStalePayments();

    expect(updates()).toEqual([]);
  });
});

describe('runDueSchedules', () => {
  const query = vi.mocked(db.query);
  const batch = vi.mocked(runBatchPayout);
  const DUE = new Date('2026-11-01T09:00:00Z');
  const schedule = { id: 'sch-1', enterprise_id: 'ent-1', name: 'Payroll', frequency: 'monthly', run_day: '1', timezone: 'UTC', next_run_at: DUE };

  beforeEach(() => {
    query.mockReset();
    batch.mockReset();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE payment_schedules\n    SET last_run_at')) return { rows: [schedule] } as any;
      if (sql.includes('FROM payment_schedule_items')) return { rows: [{ schedule_id: 'sch-1', worker_id: 'wkr-1', amount_usd: '10', memo: null }] } as any;
      return { rows: [] } as any;
    });
  });

  it('keys a run by its scheduled occurrence, so a re-run after a crash replays instead of paying again', async () => {
    batch.mockResolvedValue({ httpStatus: 201, body: { status: 'completed' } });

    await runDueSchedules();
    await runDueSchedules(); // next_run_at was not advanced (e.g. the process died before recording the run)

    expect(batch).toHaveBeenCalledTimes(2);
    const keys = batch.mock.calls.map((c) => c[2]);
    expect(keys[0]).toBe(`schedule:sch-1:${DUE.toISOString()}`);
    expect(keys[1]).toBe(keys[0]);
  });

  it('runs the batch in-process for the schedule owner', async () => {
    batch.mockResolvedValue({ httpStatus: 201, body: { status: 'completed' } });

    await runDueSchedules();

    expect(batch).toHaveBeenCalledWith('ent-1', [{ workerId: 'wkr-1', amountUsd: 10, memo: undefined }], expect.any(String));
  });

  it('records a batch still running elsewhere as in progress, not failed', async () => {
    batch.mockResolvedValue({ httpStatus: 409, body: { error: 'Batch with this idempotency key is already being processed' } });

    await runDueSchedules();

    const after = query.mock.calls.find(([sql]) => String(sql).includes('SET next_run_at'));
    expect(after?.[1]?.[1]).toBe('partial');
  });
});
