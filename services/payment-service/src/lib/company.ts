import { query } from '@funti3r/database';

export interface CompanyContext {
  companyId: string | null;
  companyRole: 'owner' | 'admin' | 'member';
  ownerUserId: string;
}

async function resolveCompanyContext(userId: string): Promise<CompanyContext | null> {
  const r = await query(
    `SELECT em.enterprise_id AS company_id, em.company_role, e.user_id AS owner_user_id
       FROM enterprise_members em JOIN enterprises e ON e.id = em.enterprise_id
      WHERE em.user_id = $1 AND em.status = 'active'`,
    [userId],
  );
  if (!r.rows.length) return null;
  return { companyId: r.rows[0].company_id, companyRole: r.rows[0].company_role, ownerUserId: r.rows[0].owner_user_id };
}

// A solo enterprise account can create a wallet and send payouts today
// without ever having visited Settings (no enterprises/enterprise_members row
// yet — those are created lazily by PATCH /users/me in user-service). Falling
// back to "you are the owner of your own not-yet-formalized company" preserves
// that existing behavior exactly. Safe: acceptCompanyInvite always writes an
// active enterprise_members row atomically at registration, so any
// 'enterprise'-role account with no active row is, by construction, a
// not-yet-formalized solo owner — never a misrouted teammate.
export async function resolveCompanyContextOrSelf(
  userId: string,
  requesterRole: string | undefined,
): Promise<CompanyContext | null> {
  const ctx = await resolveCompanyContext(userId);
  if (ctx) return ctx;
  if (requesterRole === 'enterprise') return { companyId: null, companyRole: 'owner', ownerUserId: userId };
  return null;
}

export { resolveCompanyContext };

export function canMoveMoney(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/** True if workerId is an active worker of companyId (enterprises.id). */
export async function isCompanyWorker(companyId: string | null, workerId: string): Promise<boolean> {
  if (!companyId) return false;
  const r = await query(
    `SELECT 1 FROM enterprise_workers WHERE enterprise_id = $1 AND worker_id = $2 AND status = 'active'`,
    [companyId, workerId],
  );
  return r.rows.length > 0;
}
