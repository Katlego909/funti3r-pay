import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAccount, closureBlockers, type ClosureDeps } from './accountClosure.js';

const USER = 'user-1';
/** A statement that changes data (the row-lock SELECT ... FOR UPDATE does not). */
const isWrite = (sql: string) => /^\s*(UPDATE|DELETE|INSERT)\b/.test(sql);

/** Records every statement, answers the few reads the closure makes. */
function fakeDeps(opts: { otherMembers?: number; paymentBlockers?: string[]; status?: string; paymentError?: Error } = {}) {
  const statements: string[] = [];
  const query = async (sql: string) => {
    statements.push(sql);
    if (/FROM enterprise_members other/.test(sql)) return { rows: [{ n: String(opts.otherMembers ?? 0) }] };
    if (/SELECT email, status FROM users/.test(sql)) return { rows: [{ email: 'Ada@Example.com', status: opts.status ?? 'active' }] };
    return { rows: [] };
  };
  let committed = false;
  const deps: ClosureDeps = {
    query,
    transaction: async (fn) => {
      const r = await fn({ query });
      committed = true;
      return r;
    },
    paymentBlockers: async () => {
      if (opts.paymentError) throw opts.paymentError;
      return opts.paymentBlockers ?? [];
    },
  };
  return { deps, statements, committed: () => committed };
}

test('nothing blocks an account with no money, escrows, payroll or teammates', async () => {
  const { deps } = fakeDeps();
  assert.deepEqual(await closureBlockers(USER, deps), []);
});

test('a company owner with other members is blocked, as are payment-service blockers', async () => {
  const { deps } = fakeDeps({ otherMembers: 2, paymentBlockers: ['Your wallet still holds 10 USDC.'] });
  const blockers = await closureBlockers(USER, deps);
  assert.equal(blockers.length, 2);
  assert.match(blockers[0], /2 other member/);
  assert.match(blockers[1], /10 USDC/);
});

test('a blocked account is not touched', async () => {
  const { deps, statements, committed } = fakeDeps({ paymentBlockers: ['1 escrow(s) are still active.'] });
  const result = await closeAccount(USER, 'worker', 'req-1', deps);
  assert.deepEqual(result, { closed: false, blockers: ['1 escrow(s) are still active.'] });
  assert.equal(committed(), false);
  assert.ok(!statements.some(isWrite));
});

test('if payment-service cannot answer, nothing is closed', async () => {
  const { deps, committed } = fakeDeps({ paymentError: new Error('connect ECONNREFUSED') });
  await assert.rejects(closeAccount(USER, 'worker', undefined, deps), /ECONNREFUSED/);
  assert.equal(committed(), false);
});

test('closing wipes personal data and the key, keeps financial records, and is audited', async () => {
  const { deps, statements, committed } = fakeDeps();
  assert.deepEqual(await closeAccount(USER, 'worker', 'req-1', deps), { closed: true });
  assert.equal(committed(), true);

  const all = statements.join('\n');
  assert.match(all, /SET status = 'closed', email = 'closed-' \|\| id/);
  assert.match(all, /first_name = NULL, last_name = NULL, phone = NULL, stellar_secret_key = NULL/);
  assert.match(all, /DELETE FROM user_credentials/);
  assert.match(all, /UPDATE kyc_records SET data = NULL/);
  assert.match(all, /UPDATE wallets SET encrypted_secret = NULL/);
  assert.match(all, /UPDATE enterprise_workers SET status = 'removed'/);
  assert.match(all, /INSERT INTO audit_events .*'account_closed'/s);
  // Records the law requires us to keep are never deleted.
  assert.doesNotMatch(all, /DELETE FROM (users|payments|escrows|cashouts|kyc_records|kyc_events|wallets)\b/);
});

test('closing an already closed account changes nothing', async () => {
  const { deps, statements } = fakeDeps({ status: 'closed' });
  assert.deepEqual(await closeAccount(USER, 'worker', undefined, deps), { closed: true });
  assert.ok(!statements.some(isWrite));
});
