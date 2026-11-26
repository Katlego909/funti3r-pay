/**
 * Granting and revoking platform admin. The only way anyone becomes an admin: sign-up never offers the role
 * (lib/authPolicy.ts). Run by a developer with database access, through scripts/grant-admin.ts.
 *
 * The change applies to the person's sessions at their next token refresh (within 15 minutes): every session is minted
 * from the database role (issueSession in index.ts).
 */
import type { AuditEntry } from '@funti3r/database';
import { SELF_REGISTER_ROLES, type SelfRegisterRole } from './authPolicy.js';

interface Rows { rows: any[] }
export interface AdminGrantDeps {
  query: (sql: string, params?: unknown[]) => Promise<Rows>;
  audit: (entry: AuditEntry) => Promise<void>;
  /** Who ran it (the operating-system user), for the audit trail. */
  operator: string;
}

export type GrantResult =
  | { changed: true; userId: string; from: string; to: string }
  | { changed: false; userId: string; reason: string };

async function findUser(email: string, deps: AdminGrantDeps): Promise<{ id: string; role: string; status: string }> {
  const r = await deps.query('SELECT id, role, status FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (!r.rows.length) throw new Error(`No account with the email ${email}`);
  return r.rows[0];
}

async function setRole(
  user: { id: string; role: string }, to: string, action: 'admin.granted' | 'admin.revoked', deps: AdminGrantDeps,
): Promise<GrantResult> {
  await deps.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [to, user.id]);
  await deps.audit({
    actorId: null, actorRole: 'developer', action, entityType: 'user', entityId: user.id,
    detail: { from: user.role, to, by: deps.operator },
  });
  return { changed: true, userId: user.id, from: user.role, to };
}

/** Makes an existing, active account a platform admin. Use a dedicated account, not someone's company login. */
export async function grantAdmin(email: string, deps: AdminGrantDeps): Promise<GrantResult> {
  const user = await findUser(email, deps);
  if (user.status !== 'active') throw new Error(`The account is ${user.status}; only an active account can be made an admin`);
  if (user.role === 'admin') return { changed: false, userId: user.id, reason: 'already an admin' };
  return setRole(user, 'admin', 'admin.granted', deps);
}

/** Takes admin away, turning the account back into an ordinary enterprise or worker account. */
export async function revokeAdmin(email: string, to: SelfRegisterRole, deps: AdminGrantDeps): Promise<GrantResult> {
  if (!(SELF_REGISTER_ROLES as readonly string[]).includes(to)) throw new Error('Revoke to enterprise or worker');
  const user = await findUser(email, deps);
  if (user.role !== 'admin') return { changed: false, userId: user.id, reason: `not an admin (role: ${user.role})` };
  return setRole(user, to, 'admin.revoked', deps);
}
