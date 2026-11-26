/**
 * Joining a company through a teammate invite.
 *
 * The invite is checked BEFORE it is used up. Linking a worker can never fail (ON CONFLICT DO NOTHING), but joining a
 * company can: the v1 "no company switcher" partial unique index forbids a second active membership. If the invite were
 * marked accepted first and the join then failed, the invitee would be left with a dead link and no way to retry short
 * of a brand-new invite. Everything runs in one transaction, so a lost race (23505 from a concurrent accept) rolls the
 * invite back to pending too, ready for a genuine retry. The inviter is told after the commit (see `notify`).
 */
import type { Notification } from '@funti3r/database';

interface Rows { rows: any[] }
type Query = (sql: string, params?: unknown[]) => Promise<Rows>;

export interface CompanyInviteDeps {
  query: Query;
  /** Runs `fn` in one database transaction. */
  transaction: <T>(fn: (client: { query: Query }) => Promise<T>) => Promise<T>;
  notify: (n: Notification) => Promise<void>;
}

export type AcceptResult = 'accepted' | 'invalid' | 'already_member';

export async function acceptCompanyInvite(token: string, userId: string, deps: CompanyInviteDeps): Promise<AcceptResult> {
  const outcome = await deps.transaction(async (client): Promise<{ result: AcceptResult; inviterId?: string }> => {
    const invRes = await client.query(
      `SELECT id, enterprise_id, company_role, invited_by
         FROM enterprise_member_invites
        WHERE token = $1 AND status = 'pending' AND expires_at > NOW()
        FOR UPDATE`,
      [token],
    );
    if (!invRes.rows.length) return { result: 'invalid' };
    const { id: inviteId, enterprise_id: companyId, company_role: companyRole, invited_by: inviterId } = invRes.rows[0];

    // Any existing active membership blocks the join, even in another company: the intended v1 boundary.
    const activeRes = await client.query(
      `SELECT 1 FROM enterprise_members WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    if (activeRes.rows.length) return { result: 'already_member' };

    await client.query(`UPDATE enterprise_member_invites SET status = 'accepted' WHERE id = $1`, [inviteId]);

    try {
      // DO UPDATE (not DO NOTHING) so re-inviting a removed member reactivates their row instead of hitting
      // UNIQUE(enterprise_id, user_id).
      await client.query(
        `INSERT INTO enterprise_members (enterprise_id, user_id, company_role, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (enterprise_id, user_id) DO UPDATE
           SET status = 'active', company_role = EXCLUDED.company_role, updated_at = NOW()`,
        [companyId, userId, companyRole],
      );
    } catch (err: any) {
      if (err?.code === '23505') return { result: 'already_member' }; // lost a race; the transaction undoes the UPDATE
      throw err;
    }

    return { result: 'accepted', inviterId };
  });

  // After the commit: a failed insert inside the transaction would abort it and silently undo the join.
  if (outcome.result === 'accepted' && outcome.inviterId) {
    const joined = await deps.query('SELECT email FROM users WHERE id = $1', [userId]);
    await deps.notify({
      userId: outcome.inviterId, type: 'member_joined', title: 'New team member joined',
      body: `${joined.rows[0]?.email ?? 'A teammate'} accepted your invite and joined your company.`,
      entityType: 'enterprise_member', entityId: userId,
    });
  }
  return outcome.result;
}
