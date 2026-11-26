/**
 * The platform admin's view of accounts and companies: find anyone, see one account or company whole, and suspend or
 * reactivate an account. Read by the admin console through /admin (admin-only at the gateway and in this service).
 *
 * Columns are always named: never SELECT * here, so no secret (custodial keys, password hashes) can leak into a view.
 */
import type { AuditEntry } from '@funti3r/database';
import { escapeLike, isUuid, NotFoundError, ValidationError } from '@funti3r/shared-utils';

interface Rows { rows: any[] }
export interface AdminDirectoryDeps {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  audit: (entry: AuditEntry) => Promise<void>;
}

const SEARCH_LIMIT = 20;
const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

/**
 * Accounts and companies matching `q`: an account id or a Stellar address exactly, or part of an email or a company
 * name. Payment ids and transaction hashes are searched by payment-service (/admin/payments?q=).
 */
export async function searchDirectory(q: string, deps: AdminDirectoryDeps) {
  const term = q.trim();
  if (term.length < 2) return { users: [], companies: [] };
  const like = `%${escapeLike(term)}%`;
  const byId = isUuid(term);
  const byAddress = STELLAR_ADDRESS.test(term);

  const users = await deps.query(
    `SELECT u.id, u.email, u.role, u.status, u.stellar_public_key, u.created_at, e.company_name
       FROM users u
       LEFT JOIN enterprise_members em ON em.user_id = u.id AND em.status = 'active'
       LEFT JOIN enterprises e ON e.id = em.enterprise_id
      WHERE ${byId ? 'u.id = $1::uuid' : byAddress ? 'u.stellar_public_key = $1' : 'u.email ILIKE $1'}
      ORDER BY u.created_at DESC
      LIMIT ${SEARCH_LIMIT}`,
    [byId || byAddress ? term : like],
  );
  const companies = await deps.query(
    `SELECT e.id, e.company_name, e.country, e.created_at, owner.email AS owner_email,
            (SELECT COUNT(*) FROM enterprise_members m WHERE m.enterprise_id = e.id AND m.status = 'active')::int AS members,
            (SELECT COUNT(*) FROM enterprise_workers w WHERE w.enterprise_id = e.id AND w.status = 'active')::int AS workers
       FROM enterprises e JOIN users owner ON owner.id = e.user_id
      WHERE ${byId ? 'e.id = $1::uuid' : 'e.company_name ILIKE $1'}
      ORDER BY e.created_at DESC
      LIMIT ${SEARCH_LIMIT}`,
    [byId ? term : like],
  );
  return { users: users.rows, companies: companies.rows };
}

/** One account whole: profile, status, company ties, where it has passkeys, pending invites. Null when unknown. */
export async function accountDetail(userId: string, deps: AdminDirectoryDeps) {
  const user = (await deps.query(
    `SELECT id, email, role, status, first_name, last_name, phone, country, preferred_currency, kyc_status,
            stellar_public_key, recovered_at, created_at, updated_at
       FROM users WHERE id = $1`,
    [userId],
  )).rows[0];
  if (!user) return null;

  const [memberships, employers, passkeys, invites] = await Promise.all([
    deps.query(
      `SELECT e.id AS company_id, e.company_name, m.company_role, m.status, m.created_at
         FROM enterprise_members m JOIN enterprises e ON e.id = m.enterprise_id
        WHERE m.user_id = $1 ORDER BY m.created_at DESC`,
      [userId],
    ),
    deps.query(
      `SELECT e.id AS company_id, e.company_name, w.status, w.added_at
         FROM enterprise_workers w JOIN enterprises e ON e.id = w.enterprise_id
        WHERE w.worker_id = $1 ORDER BY w.added_at DESC`,
      [userId],
    ),
    deps.query(
      `SELECT origin, COUNT(*)::int AS count, MAX(created_at) AS last_added
         FROM user_credentials WHERE user_id = $1 GROUP BY origin ORDER BY origin`,
      [userId],
    ),
    deps.query(
      `SELECT 'worker' AS kind, status, created_at, expires_at FROM worker_invites WHERE LOWER(email) = LOWER($1)
       UNION ALL
       SELECT 'teammate' AS kind, status, created_at, expires_at FROM enterprise_member_invites WHERE LOWER(email) = LOWER($1)
       ORDER BY created_at DESC LIMIT 20`,
      [user.email],
    ),
  ]);
  return {
    user, memberships: memberships.rows, employers: employers.rows, passkeys: passkeys.rows, invites: invites.rows,
  };
}

/** One company whole: owner, members with their roles, workers, pending invites. Null when unknown. */
export async function companyDetail(companyId: string, deps: AdminDirectoryDeps) {
  const company = (await deps.query(
    `SELECT e.id, e.company_name, e.company_registration, e.country, e.created_at,
            owner.id AS owner_id, owner.email AS owner_email, owner.stellar_public_key AS wallet
       FROM enterprises e JOIN users owner ON owner.id = e.user_id
      WHERE e.id = $1`,
    [companyId],
  )).rows[0];
  if (!company) return null;

  const [members, workers, invites] = await Promise.all([
    deps.query(
      `SELECT u.id, u.email, u.status AS account_status, m.company_role, m.status, m.created_at
         FROM enterprise_members m JOIN users u ON u.id = m.user_id
        WHERE m.enterprise_id = $1 ORDER BY m.created_at`,
      [companyId],
    ),
    deps.query(
      `SELECT u.id, u.email, u.status AS account_status, u.kyc_status, u.preferred_currency, w.status, w.added_at
         FROM enterprise_workers w JOIN users u ON u.id = w.worker_id
        WHERE w.enterprise_id = $1 ORDER BY w.added_at DESC`,
      [companyId],
    ),
    deps.query(
      `SELECT 'worker' AS kind, email, status, created_at, expires_at FROM worker_invites WHERE enterprise_id = $1
       UNION ALL
       SELECT 'teammate' AS kind, email, status, created_at, expires_at FROM enterprise_member_invites WHERE enterprise_id = $2
       ORDER BY created_at DESC LIMIT 50`,
      [company.owner_id, companyId], // worker invites are keyed by the owner's user id, teammate invites by the company
    ),
  ]);
  return { company, members: members.rows, workers: workers.rows, invites: invites.rows };
}

export type StatusChange = { changed: true; status: string } | { changed: false; reason: string };

/**
 * Suspends or reactivates an account. A suspended account cannot sign in, and loses its sessions at their next refresh
 * (within 15 minutes): every session is minted from the database (issueSession). A closed account stays closed, an
 * admin cannot change their own status, and a reason is required: it goes in the audit trail with the admin's id.
 */
export async function setAccountStatus(
  userId: string,
  to: 'suspended' | 'active',
  reason: string,
  actorId: string,
  deps: AdminDirectoryDeps,
): Promise<StatusChange> {
  if (!reason.trim()) throw new ValidationError('A reason is required');
  if (userId === actorId) throw new ValidationError('You cannot change the status of your own account');
  const user = (await deps.query('SELECT status FROM users WHERE id = $1', [userId])).rows[0];
  if (!user) throw new NotFoundError('Account');
  if (user.status === 'closed') return { changed: false, reason: 'the account is closed' };
  if (user.status === to) return { changed: false, reason: `the account is already ${to}` };

  await deps.query('UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2', [to, userId]);
  await deps.audit({
    actorId, actorRole: 'admin', action: to === 'suspended' ? 'account.suspended' : 'account.reactivated',
    entityType: 'user', entityId: userId, detail: { from: user.status, to, reason: reason.trim().slice(0, 500) },
  });
  return { changed: true, status: to };
}
