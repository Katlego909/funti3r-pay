import type { Query } from './deps.js';

/** How the requester is allowed to see a user's KYC record. */
export type KycAccess = 'self' | 'admin' | 'company-admin' | 'company-member';

/**
 * Who may open a user's KYC record, and in what capacity:
 *  - the user themself, or a platform admin;
 *  - an active member of a company that has the user as an active worker (owners and admins
 *    may also decide it; plain members may only read it).
 * Anyone else gets null. Every route that touches another user's KYC goes through here, so one
 * employer can never read or decide another employer's workers.
 */
export async function kycAccess(
  query: Query, requesterId: string | undefined, requesterRole: string | undefined, targetUserId: string,
): Promise<KycAccess | null> {
  if (!requesterId) return null;
  if (requesterId === targetUserId) return 'self';
  if (requesterRole === 'admin') return 'admin';
  if (requesterRole !== 'enterprise') return null;

  const r = await query(
    `SELECT em.company_role
       FROM enterprise_members em
       JOIN enterprise_workers ew ON ew.enterprise_id = em.enterprise_id
      WHERE em.user_id = $1 AND em.status = 'active' AND ew.worker_id = $2 AND ew.status = 'active'
      LIMIT 1`,
    [requesterId, targetUserId],
  );
  const role = r.rows[0]?.company_role as string | undefined;
  if (!role) return null;
  return role === 'owner' || role === 'admin' ? 'company-admin' : 'company-member';
}

/** May this access level approve or reject? */
export const canDecide = (a: KycAccess | null): boolean => a === 'admin' || a === 'company-admin';
