import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditEntry } from '@funti3r/database';
import {
  accountDetail, companyDetail, listAccounts, listCompanies, searchDirectory, setAccountStatus, type AdminDirectoryDeps,
} from './adminDirectory.js';

/** Records every statement; answers reads with `answer(sql)`. */
function fakeDeps(answer: (sql: string) => any[] = () => []) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const audits: AuditEntry[] = [];
  const deps: AdminDirectoryDeps = {
    query: async (sql, params = []) => { statements.push({ sql, params }); return { rows: answer(sql) }; },
    audit: async (e) => { audits.push(e); },
  };
  return { deps, statements, audits };
}

const ID = '11111111-1111-4111-8111-111111111111';
const ADDRESS = 'GCTJUFKWH7PJ6NPW4FG67C2AIBOSW5QPHXOS7UAF2MEKE7ZHATSB3YFN';

test('search matches an account id or a Stellar address exactly, and part of an email or company name otherwise', async () => {
  for (const [q, clause, param] of [
    [ID, 'u.id = $1::uuid', ID],
    [ADDRESS, 'u.stellar_public_key = $1', ADDRESS],
    ['ada@', 'u.email ILIKE $1', '%ada@%'],
  ] as const) {
    const { deps, statements } = fakeDeps();
    await searchDirectory(q, deps);
    assert.ok(statements[0].sql.includes(clause), q);
    assert.deepEqual(statements[0].params, [param]);
  }
});

test('search treats % and _ in the text as plain characters, and ignores a one-letter query', async () => {
  const { deps, statements } = fakeDeps();
  await searchDirectory('50%_off', deps);
  assert.deepEqual(statements[0].params, ['%50\\%\\_off%']);
  assert.deepEqual(await searchDirectory('a', fakeDeps().deps), { users: [], companies: [] });
});

test('no admin view ever reads a secret key or a password hash', async () => {
  const { deps, statements } = fakeDeps((sql) => (/FROM users WHERE id|FROM enterprises e JOIN users owner/.test(sql) ? [{ id: ID, email: 'a@b.c', owner_id: ID }] : []));
  await searchDirectory('ada', deps);
  await accountDetail(ID, deps);
  await companyDetail(ID, deps);
  await listAccounts({}, deps);
  await listCompanies({}, deps);
  for (const { sql } of statements) {
    assert.doesNotMatch(sql, /secret|password|\*\s*FROM/i, sql);
  }
});

test('an unknown account or company is null', async () => {
  assert.equal(await accountDetail(ID, fakeDeps().deps), null);
  assert.equal(await companyDetail(ID, fakeDeps().deps), null);
});

test('suspending an active account needs a reason, writes it to the audit trail, and changes the status', async () => {
  const { deps, statements, audits } = fakeDeps((sql) => (/SELECT status FROM users/.test(sql) ? [{ status: 'active' }] : []));
  assert.deepEqual(await setAccountStatus(ID, 'suspended', ' Reported fraud ', 'admin-1', deps), { changed: true, status: 'suspended' });
  assert.ok(statements.some((s) => /UPDATE users SET status/.test(s.sql) && s.params[0] === 'suspended'));
  assert.equal(audits[0].action, 'account.suspended');
  assert.equal(audits[0].actorId, 'admin-1');
  assert.deepEqual(audits[0].detail, { from: 'active', to: 'suspended', reason: 'Reported fraud' });
});

test('no reason, your own account, a closed account or no change: nothing is written', async () => {
  const active = () => fakeDeps((sql) => (/SELECT status/.test(sql) ? [{ status: 'active' }] : []));
  await assert.rejects(setAccountStatus(ID, 'suspended', '  ', 'admin-1', active().deps), /reason/);
  await assert.rejects(setAccountStatus(ID, 'suspended', 'x', ID, active().deps), /own account/);
  const closed = fakeDeps((sql) => (/SELECT status/.test(sql) ? [{ status: 'closed' }] : []));
  assert.deepEqual(await setAccountStatus(ID, 'active', 'x', 'admin-1', closed.deps), { changed: false, reason: 'the account is closed' });
  const same = active();
  assert.equal((await setAccountStatus(ID, 'active', 'x', 'admin-1', same.deps)).changed, false);
  assert.equal(closed.audits.length + same.audits.length, 0);
});

test('the account list filters by role, status and part of the email, ignoring unknown values, a page at a time', async () => {
  const { deps, statements } = fakeDeps((sql) => (/GROUP BY u\.role/.test(sql) ? [{ role: 'worker', count: 7 }, { role: 'enterprise', count: 2 }] : []));
  const result = await listAccounts({ role: 'worker', status: 'suspended', q: 'a_b', limit: '9999' }, deps);
  const [list, counts] = statements;
  assert.match(list.sql, /WHERE u\.status = \$1 AND u\.email ILIKE \$2 AND u\.role = \$3/);
  assert.deepEqual(list.params, ['suspended', '%a\\_b%', 'worker']);
  assert.match(list.sql, /LIMIT 200 OFFSET 0/);
  // The role tabs count under the other filters, not under the chosen role.
  assert.match(counts.sql, /WHERE u\.status = \$1 AND u\.email ILIKE \$2 GROUP BY u\.role/);
  assert.deepEqual(result.byRole, { enterprise: 2, worker: 7, admin: 0 });
  assert.equal(result.total, 7);

  const unknown = fakeDeps();
  const all = await listAccounts({ role: 'superuser', status: "x' OR 1=1" }, unknown.deps);
  assert.doesNotMatch(unknown.statements[0].sql, /WHERE/);
  assert.equal(all.total, 0);
});

test('the company list filters by part of the name and says how many there are', async () => {
  const { deps, statements } = fakeDeps((sql) => (/COUNT\(\*\)::int AS count FROM enterprises/.test(sql) ? [{ count: 3 }] : []));
  const result = await listCompanies({ q: 'Ardent', offset: '50' }, deps);
  assert.match(statements[0].sql, /WHERE e\.company_name ILIKE \$1/);
  assert.match(statements[0].sql, /LIMIT 50 OFFSET 50/);
  assert.deepEqual(statements[0].params, ['%Ardent%']);
  assert.equal(result.total, 3);
});

