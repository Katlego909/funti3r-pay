import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { query } from '@funti3r/database';
import * as escrow from '../lib/escrow.js';
import app from '../app.js';
import { parseSubmission } from '../routes/escrows.js';
import { createQueryMock, WORKER_ID, ENTERPRISE_ID, MEMBER_ID } from './helpers.js';

const ESCROW_ID = 'escrow-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const enterpriseHeaders = { 'x-user-id': ENTERPRISE_ID, 'x-user-role': 'enterprise' };
const workerHeaders = { 'x-user-id': WORKER_ID, 'x-user-role': 'worker' };

// ── Query handlers for the review routes ─────────────────────────────────────

/** What the submit route reads: the worker's own milestone. */
function submitLookup(row: Record<string, unknown> | null) {
  return {
    match: /SELECT e\.enterprise_id, e\.status AS escrow_status/,
    handler: () => ({ rows: row ? [{ enterprise_id: ENTERPRISE_ID, escrow_status: 'active', status: 'pending', review_status: 'none', ...row }] : [] }),
  };
}

/** What the reject route reads: the enterprise's own milestone. */
function rejectLookup(row: Record<string, unknown> | null) {
  return {
    match: /SELECT e\.worker_id, e\.status AS escrow_status/,
    handler: () => ({ rows: row ? [{ worker_id: WORKER_ID, escrow_status: 'active', status: 'pending', review_status: 'submitted', ...row }] : [] }),
  };
}

const TAKE_SUBMIT = { match: /SET review_status = 'submitted'/, handler: () => ({ rows: [{ idx: 0 }] }) };
const TAKE_SUBMIT_LOST = { match: /SET review_status = 'submitted'/, handler: () => ({ rows: [] }) };
const TAKE_REJECT = { match: /SET review_status = 'rejected'/, handler: () => ({ rows: [{ idx: 0 }] }) };

const calls = (re: RegExp) => vi.mocked(query).mock.calls.filter(([sql]) => re.test(sql));
const notifications = () => calls(/INSERT INTO notifications/).map(([, p]) => p as unknown[]);
const events = () => calls(/INSERT INTO escrow_milestone_events/).map(([, p]) => p as unknown[]);

beforeEach(() => {
  vi.mocked(query).mockReset().mockImplementation(createQueryMock([]));
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { status: 'verified' } });
  vi.mocked(escrow.approveMilestone).mockReset();
});

// ── parseSubmission ──────────────────────────────────────────────────────────

describe('parseSubmission', () => {
  it('accepts a note, links, or both', () => {
    expect(parseSubmission({ note: ' Done ' })).toEqual({ note: 'Done', links: [] });
    expect(parseSubmission({ links: ['https://example.com/a'] })).toEqual({ note: '', links: ['https://example.com/a'] });
    expect(parseSubmission({ note: 'x', links: ['http://example.com'] })).toMatchObject({ links: ['http://example.com'] });
  });

  it('needs something to review', () => {
    expect(parseSubmission({})).toHaveProperty('error');
    expect(parseSubmission({ note: '   ', links: [] })).toHaveProperty('error');
    expect(parseSubmission(undefined)).toHaveProperty('error');
  });

  it('rejects non-http(s) links — no javascript:, data: or file: URLs reach the employer', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'not a url', '']) {
      expect(parseSubmission({ links: [bad] })).toHaveProperty('error');
    }
  });

  it('enforces size limits', () => {
    expect(parseSubmission({ note: 'x'.repeat(2001) })).toHaveProperty('error');
    expect(parseSubmission({ links: Array.from({ length: 6 }, (_, i) => `https://e.com/${i}`) })).toHaveProperty('error');
    expect(parseSubmission({ links: [`https://e.com/${'a'.repeat(500)}`] })).toHaveProperty('error');
    expect(parseSubmission({ links: 'https://e.com' })).toHaveProperty('error');
  });
});

// ── POST /escrows/:id/milestones/:idx/submit ─────────────────────────────────

describe('submit work', () => {
  const submit = (body: unknown, headers = workerHeaders) =>
    request(app).post(`/escrows/${ESCROW_ID}/milestones/0/submit`).set(headers).send(body as object);

  it('403s a non-worker', async () => {
    expect((await submit({ note: 'done' }, enterpriseHeaders)).status).toBe(403);
  });

  it('400s an invalid submission before touching the database', async () => {
    const res = await submit({ links: ['javascript:alert(1)'] });
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('404s a milestone that is not this worker\'s', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([submitLookup(null)]));
    expect((await submit({ note: 'done' })).status).toBe(404);
  });

  it('409s once the milestone is no longer pending, or the escrow is closed', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([submitLookup({ status: 'approved' })]));
    expect((await submit({ note: 'done' })).status).toBe(409);

    vi.mocked(query).mockImplementation(createQueryMock([submitLookup({ escrow_status: 'completed' })]));
    expect((await submit({ note: 'done' })).status).toBe(409);
  });

  it('409s a second submission while one is already waiting for review', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([submitLookup({ review_status: 'submitted' }), TAKE_SUBMIT]));
    const res = await submit({ note: 'again' });
    expect(res.status).toBe(409);
    expect(events()).toHaveLength(0);
  });

  it('a double-click that loses the race records nothing twice', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([submitLookup({}), TAKE_SUBMIT_LOST]));
    const res = await submit({ note: 'done' });
    expect(res.status).toBe(409);
    expect(events()).toHaveLength(0);
    expect(notifications()).toHaveLength(0);
  });

  it('records the submission in the audit trail and tells the employer', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([submitLookup({}), TAKE_SUBMIT]));
    const res = await submit({ note: 'Designs attached', links: ['https://figma.com/file/1'] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reviewStatus: 'submitted' });
    expect(events()).toEqual([[ESCROW_ID, 0, 'submitted', WORKER_ID, 'worker', 'Designs attached', JSON.stringify(['https://figma.com/file/1'])]]);
    const [n] = notifications();
    expect(n).toEqual([ENTERPRISE_ID, 'escrow_work_submitted', 'Work submitted for review', expect.stringContaining('milestone 1'), ESCROW_ID]);
  });

  it('lets the worker resubmit after the employer sent it back', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([submitLookup({ review_status: 'rejected' }), TAKE_SUBMIT]));
    expect((await submit({ note: 'fixed' })).status).toBe(200);
  });
});

// ── POST /escrows/:id/milestones/:idx/reject ─────────────────────────────────

describe('reject work', () => {
  const reject = (body: unknown, headers: Record<string, string> = enterpriseHeaders) =>
    request(app).post(`/escrows/${ESCROW_ID}/milestones/0/reject`).set(headers).send(body as object);

  it('403s a worker and a company member (owner/admin only)', async () => {
    expect((await reject({ reason: 'no' }, workerHeaders)).status).toBe(403);
    expect((await reject({ reason: 'no' }, { 'x-user-id': MEMBER_ID, 'x-user-role': 'enterprise' })).status).toBe(403);
  });

  it('requires a reason the worker can act on', async () => {
    expect((await reject({})).status).toBe(400);
    expect((await reject({ reason: '   ' })).status).toBe(400);
    expect((await reject({ reason: 'x'.repeat(1001) })).status).toBe(400);
  });

  it('404s an escrow that is not the employer\'s', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([rejectLookup(null)]));
    expect((await reject({ reason: 'no' })).status).toBe(404);
  });

  it('409s when nothing was submitted, or the milestone moved on', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([rejectLookup({ review_status: 'none' })]));
    expect((await reject({ reason: 'no' })).status).toBe(409);

    vi.mocked(query).mockImplementation(createQueryMock([rejectLookup({ status: 'approved' })]));
    expect((await reject({ reason: 'no' })).status).toBe(409);
  });

  it('409s when the submission was already reviewed in the meantime', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([rejectLookup({}), { match: /SET review_status = 'rejected'/, handler: () => ({ rows: [] }) }]));
    const res = await reject({ reason: 'no' });
    expect(res.status).toBe(409);
    expect(events()).toHaveLength(0);
  });

  it('sends the work back with the reason on record and tells the worker — nothing happens on-chain', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([rejectLookup({}), TAKE_REJECT]));
    const res = await reject({ reason: 'Logo is missing' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reviewStatus: 'rejected' });
    expect(events()).toEqual([[ESCROW_ID, 0, 'rejected', ENTERPRISE_ID, 'enterprise', 'Logo is missing', '[]']]);
    const [n] = notifications();
    expect(n).toEqual([WORKER_ID, 'escrow_work_rejected', 'Changes requested', expect.stringContaining('Logo is missing'), ESCROW_ID]);
    expect(escrow.approveMilestone).not.toHaveBeenCalled();
  });
});

// ── approve records its decision; GET exposes the trail ──────────────────────

describe('audit trail', () => {
  it('approving records the decision (with an optional note) in the trail', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      { match: /FROM escrows WHERE id = \$1 AND enterprise_id/, handler: () => ({ rows: [{ id: ESCROW_ID, worker_id: WORKER_ID, onchain_escrow_id: '0', status: 'active' }] }) },
      { match: /FROM escrow_milestones WHERE escrow_id = \$1 AND idx/, handler: () => ({ rows: [{ status: 'pending', amount: '25' }] }) },
      { match: /^SELECT stellar_secret_key FROM users/, handler: () => ({ rows: [{ stellar_secret_key: 'SFAKE' }] }) },
      { match: /^SELECT stellar_public_key FROM users WHERE id/, handler: () => ({ rows: [{ stellar_public_key: 'GWORKER' }] }) },
    ]));
    vi.mocked(escrow.approveMilestone).mockResolvedValue('tx-approve');

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/approve`).set(enterpriseHeaders).send({ note: 'Great work' });
    expect(res.status).toBe(200);
    expect(events()).toEqual([[ESCROW_ID, 0, 'approved', ENTERPRISE_ID, 'enterprise', 'Great work', '[]']]);
  });

  it('a failed audit write never fails an approval that already happened on-chain', async () => {
    vi.mocked(query).mockImplementation(vi.fn(async (sql: string) => {
      if (/INSERT INTO escrow_milestone_events/.test(sql)) throw new Error('db down');
      return createQueryMock([
        { match: /FROM escrows WHERE id = \$1 AND enterprise_id/, handler: () => ({ rows: [{ id: ESCROW_ID, worker_id: WORKER_ID, onchain_escrow_id: '0', status: 'active' }] }) },
        { match: /FROM escrow_milestones WHERE escrow_id = \$1 AND idx/, handler: () => ({ rows: [{ status: 'pending', amount: '25' }] }) },
        { match: /^SELECT stellar_secret_key FROM users/, handler: () => ({ rows: [{ stellar_secret_key: 'SFAKE' }] }) },
        { match: /^SELECT stellar_public_key FROM users WHERE id/, handler: () => ({ rows: [{ stellar_public_key: 'GWORKER' }] }) },
      ])(sql);
    }) as never);
    vi.mocked(escrow.approveMilestone).mockResolvedValue('tx-approve');

    const res = await request(app).post(`/escrows/${ESCROW_ID}/milestones/0/approve`).set(enterpriseHeaders);
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe('tx-approve');
  });

  it('GET /escrows returns each milestone\'s review status and the escrow\'s review events', async () => {
    vi.mocked(query).mockImplementation(createQueryMock([
      {
        match: /FROM escrows e/,
        handler: () => ({
          rows: [{
            id: ESCROW_ID, worker_id: WORKER_ID, worker_email: 'w@test.com', onchain_escrow_id: '0',
            contract_address: 'C', token_code: 'XLM', total_amount: '25', status: 'active',
            expires_at: new Date().toISOString(), create_tx_hash: 't', created_at: new Date().toISOString(),
          }],
        }),
      },
      {
        match: /FROM escrow_milestones WHERE escrow_id = ANY/,
        handler: () => ({ rows: [{ escrow_id: ESCROW_ID, idx: 0, description: 'Design', amount: '25', status: 'pending', review_status: 'rejected' }] }),
      },
      {
        match: /FROM escrow_milestone_events/,
        handler: () => ({
          rows: [
            { escrow_id: ESCROW_ID, idx: 0, kind: 'submitted', actor_role: 'worker', note: 'Done', links: ['https://e.com'], created_at: '2026-10-08T10:00:00Z' },
            { escrow_id: ESCROW_ID, idx: 0, kind: 'rejected', actor_role: 'enterprise', note: 'Logo missing', links: [], created_at: '2026-10-08T11:00:00Z' },
          ],
        }),
      },
    ]));

    const res = await request(app).get('/escrows').set(enterpriseHeaders);
    expect(res.status).toBe(200);
    expect(res.body.escrows[0].milestones[0].reviewStatus).toBe('rejected');
    expect(res.body.escrows[0].reviewEvents).toEqual([
      { idx: 0, kind: 'submitted', by: 'worker', note: 'Done', links: ['https://e.com'], at: '2026-10-08T10:00:00Z' },
      { idx: 0, kind: 'rejected', by: 'enterprise', note: 'Logo missing', links: [], at: '2026-10-08T11:00:00Z' },
    ]);
  });
});
