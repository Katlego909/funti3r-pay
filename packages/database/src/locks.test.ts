import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { closePostgres, initPostgres } from './postgres.js';
import { tryWithAdvisoryLock, withAdvisoryLock } from './locks.js';

// These need a real Postgres (advisory locks are a Postgres feature). Without DATABASE_URL, or when it is not
// reachable, they are skipped rather than failed, so CI without a database stays green.
let skip: string | false = false;

before(async () => {
  if (!process.env.DATABASE_URL) { skip = 'DATABASE_URL not set'; return; }
  try {
    await initPostgres();
  } catch (err) {
    skip = `database not reachable: ${(err as Error).message}`;
  }
});
after(async () => { if (!skip) await closePostgres(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('callers using the same lock name run one at a time', async (t) => {
  if (skip) return t.skip(skip);
  const log: string[] = [];
  const job = (id: string) => withAdvisoryLock('test:serial', async () => {
    log.push(`start ${id}`);
    await sleep(60);
    log.push(`end ${id}`);
  });
  await Promise.all([job('a'), job('b'), job('c')]);
  // Never two starts in a row: each job finished before the next began.
  for (let i = 0; i < log.length; i += 2) {
    assert.match(log[i], /^start/);
    assert.equal(log[i + 1], log[i].replace('start', 'end'));
  }
});

test('different lock names do not block each other', async (t) => {
  if (skip) return t.skip(skip);
  const started = Date.now();
  await Promise.all([
    withAdvisoryLock('test:one', () => sleep(120)),
    withAdvisoryLock('test:two', () => sleep(120)),
  ]);
  assert.ok(Date.now() - started < 220, 'ran in parallel');
});

test('a busy lock makes tryWithAdvisoryLock step aside, and it is free again afterwards', async (t) => {
  if (skip) return t.skip(skip);
  let inside: Awaited<ReturnType<typeof tryWithAdvisoryLock<string>>> | undefined;
  await withAdvisoryLock('test:job', async () => {
    inside = await tryWithAdvisoryLock('test:job', async () => 'second runner');
  });
  assert.deepEqual(inside, { ran: false });
  const after = await tryWithAdvisoryLock('test:job', async () => 'free now');
  assert.deepEqual(after, { ran: true, result: 'free now' });
});

test('the lock is released when the job throws', async (t) => {
  if (skip) return t.skip(skip);
  await assert.rejects(withAdvisoryLock('test:throws', async () => { throw new Error('boom'); }), /boom/);
  const next = await tryWithAdvisoryLock('test:throws', async () => 'ok');
  assert.deepEqual(next, { ran: true, result: 'ok' });
});
