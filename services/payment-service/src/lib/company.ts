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

/**
 * The ids in `workerIds` that are active workers of `companyId` (enterprises.id), in one query. None without a
 * company: an owner who never set one up cannot have invited anyone (inviting requires membership).
 */
export async function companyWorkerIds(companyId: string | null, workerIds: string[]): Promise<Set<string>> {
  if (!companyId || workerIds.length === 0) return new Set();
  const r = await query<{ worker_id: string }>(
    `SELECT worker_id FROM enterprise_workers WHERE enterprise_id = $1 AND worker_id = ANY($2::uuid[]) AND status = 'active'`,
    [companyId, workerIds],
  );
  return new Set(r.rows.map((row) => row.worker_id));
}

/** True if workerId is an active worker of companyId (enterprises.id). */
export async function isCompanyWorker(companyId: string | null, workerId: string): Promise<boolean> {
  return (await companyWorkerIds(companyId, [workerId])).has(workerId);
}

/**
 * The company paying from the owner's wallet. Payments are recorded against the owner's user id, so this is how a
 * payout (from a route or from the scheduler) knows whose team its payee must be on.
 */
export async function ownerCompanyId(ownerUserId: string): Promise<string | null> {
  return (await resolveCompanyContext(ownerUserId))?.companyId ?? null;
}

/** The refusal for paying someone who is not on the paying company's team. */
export const NOT_ON_TEAM = 'This person is not on your team. Add them to your team first';
