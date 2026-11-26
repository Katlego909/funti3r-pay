import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notify } from './notifications.js';
import { recoveryHold, RecoveryHoldError, RECOVERY_HOLD_MS } from './recoveryHold.js';

// A stand-in query: answers the recovered_at lookup, or fails like a lost database.
const recoveredAt = (at: Date | null) => (async () => ({ rows: [{ recovered_at: at }] })) as never;
const broken = (async () => { throw new Error('database down'); }) as never;

async function run(middleware: ReturnType<typeof recoveryHold>, userId?: string): Promise<unknown> {
  let passed: unknown = 'not called';
  await middleware({ headers: userId ? { 'x-user-id': userId } : {} }, {}, (err) => { passed = err; });
  return passed;
}

test('blocks a user recovered by email within the last 48 hours', async () => {
  const err = await run(recoveryHold(recoveredAt(new Date(Date.now() - 60_000))), 'user-1');
  assert.ok(err instanceof RecoveryHoldError);
  assert.equal(err.statusCode, 403);
});

test('lets the user through once the 48 hours have passed, or if they never recovered', async () => {
  assert.equal(await run(recoveryHold(recoveredAt(new Date(Date.now() - RECOVERY_HOLD_MS - 1))), 'user-1'), undefined);
  assert.equal(await run(recoveryHold(recoveredAt(null)), 'user-1'), undefined);
});

test('a database error blocks the request instead of skipping the hold', async () => {
  const err = await run(recoveryHold(broken), 'user-1');
  assert.ok(err instanceof Error && err.message === 'database down');
});

test('a request without an identity goes on to the route own auth check', async () => {
  assert.equal(await run(recoveryHold(broken)), undefined);
});

test('a notification that cannot be saved never fails the caller', async () => {
  await assert.doesNotReject(notify({ userId: 'u', type: 't', title: 'x', body: 'y' }, broken));
});
