import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuditEntry } from '@funti3r/database';
import { grantAdmin, revokeAdmin, type AdminGrantDeps } from './adminGrant.js';

/** A fake users table holding one account, recording updates and audit rows. */
function fakeDeps(user: { id: string; role: string; status: string } | null) {
  const updates: unknown[][] = [];
  const audits: AuditEntry[] = [];
  const deps: AdminGrantDeps = {
    operator: 'dev-laptop',
    query: async (sql, params = []) => {
      if (/^SELECT id, role, status FROM users/.test(sql)) return { rows: user ? [user] : [] };
      if (/^UPDATE users SET role/.test(sql)) updates.push(params);
      return { rows: [] };
    },
    audit: async (e) => { audits.push(e); },
  };
  return { deps, updates, audits };
}

test('grants admin to an active account and records who did it', async () => {
  const { deps, updates, audits } = fakeDeps({ id: 'u1', role: 'worker', status: 'active' });
  assert.deepEqual(await grantAdmin('Dev@Funti3r.xyz', deps), { changed: true, userId: 'u1', from: 'worker', to: 'admin' });
  assert.deepEqual(updates, [['admin', 'u1']]);
  assert.equal(audits[0].action, 'admin.granted');
  assert.deepEqual(audits[0].detail, { from: 'worker', to: 'admin', by: 'dev-laptop' });
});

test('refuses a suspended or closed account, and an unknown email', async () => {
  await assert.rejects(grantAdmin('x@y.z', fakeDeps({ id: 'u1', role: 'worker', status: 'suspended' }).deps), /suspended/);
  await assert.rejects(grantAdmin('x@y.z', fakeDeps(null).deps), /No account/);
});

test('granting twice changes nothing and writes no audit row', async () => {
  const { deps, updates, audits } = fakeDeps({ id: 'u1', role: 'admin', status: 'active' });
  assert.equal((await grantAdmin('x@y.z', deps)).changed, false);
  assert.equal(updates.length + audits.length, 0);
});

test('revoking turns an admin back into an enterprise or worker account, never another admin role', async () => {
  const { deps, updates, audits } = fakeDeps({ id: 'u1', role: 'admin', status: 'active' });
  assert.deepEqual(await revokeAdmin('x@y.z', 'worker', deps), { changed: true, userId: 'u1', from: 'admin', to: 'worker' });
  assert.deepEqual(updates, [['worker', 'u1']]);
  assert.equal(audits[0].action, 'admin.revoked');
  await assert.rejects(revokeAdmin('x@y.z', 'admin' as never, deps), /enterprise or worker/);
});
