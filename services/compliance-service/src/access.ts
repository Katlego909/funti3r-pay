import type { Query } from './deps.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Of `ids`, the user ids this requester may read KYC status for: all of them for a platform admin, their own id for anyone,
 * and the active workers of their company for a company member. Ids that are not valid ids are never visible.
 */
export async function visibleUserIds(
  query: Query, requesterId: string | undefined, requesterRole: string | undefined, ids: string[],
): Promise<string[]> {
  const valid = ids.filter((id) => UUID.test(id));
  if (requesterRole === 'admin') return valid;
  if (!requesterId) return [];
  const visible = new Set(valid.filter((id) => id === requesterId));
  if (requesterRole === 'enterprise' && valid.length > 0) {
    const r = await query(
      `SELECT DISTINCT ew.worker_id AS id
         FROM enterprise_members em
         JOIN enterprise_workers ew ON ew.enterprise_id = em.enterprise_id
        WHERE em.user_id = $1 AND em.status = 'active' AND ew.status = 'active' AND ew.worker_id = ANY($2::uuid[])`,
      [requesterId, valid],
    );
    for (const row of r.rows) visible.add(row.id as string);
  }
  return [...visible];
}

/** May this access level approve or reject? */
export const canDecide = (a: KycAccess | null): boolean => a === 'admin' || a === 'company-admin';
