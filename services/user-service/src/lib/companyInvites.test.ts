import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptCompanyInvite, type CompanyInviteDeps } from './companyInvites.js';

const INVITE = { id: 'inv-1', enterprise_id: 'co-1', company_role: 'admin', invited_by: 'owner-1' };

/** A fake database that knows whether a statement or notification happened inside the transaction. */
function fakeDeps(opts: { invite?: boolean; alreadyMember?: boolean } = {}) {
  let inTransaction = false;
  let committed = false;
  const notifiedInsideTransaction: boolean[] = [];
  const query = async (sql: string) => {
    if (/FROM enterprise_member_invites/.test(sql)) return { rows: opts.invite === false ? [] : [INVITE] };
    if (/SELECT 1 FROM enterprise_members/.test(sql)) return { rows: opts.alreadyMember ? [{}] : [] };
    if (/SELECT email FROM users/.test(sql)) return { rows: [{ email: 'ada@example.com' }] };
    return { rows: [] };
  };
  const deps: CompanyInviteDeps = {
    query,
    transaction: async (fn) => {
      inTransaction = true;
      try {
        const r = await fn({ query });
        committed = true;
        return r;
      } finally {
        inTransaction = false;
      }
    },
    notify: async () => {
      notifiedInsideTransaction.push(inTransaction);
    },
  };
  return { deps, notifiedInsideTransaction, committed: () => committed };
}

test('joins the company and tells the inviter only after the join has committed', async () => {
  const { deps, notifiedInsideTransaction, committed } = fakeDeps();
  assert.equal(await acceptCompanyInvite('tok', 'user-1', deps), 'accepted');
  assert.ok(committed());
  // Inside the transaction, a failed notification insert would abort it and COMMIT would silently roll the join back.
  assert.deepEqual(notifiedInsideTransaction, [false]);
});

test('a used or expired invite is invalid, and nobody is told anything', async () => {
  const { deps, notifiedInsideTransaction } = fakeDeps({ invite: false });
  assert.equal(await acceptCompanyInvite('tok', 'user-1', deps), 'invalid');
  assert.deepEqual(notifiedInsideTransaction, []);
});

test('someone already in a company cannot join a second one', async () => {
  const { deps, notifiedInsideTransaction } = fakeDeps({ alreadyMember: true });
  assert.equal(await acceptCompanyInvite('tok', 'user-1', deps), 'already_member');
  assert.deepEqual(notifiedInsideTransaction, []);
});
