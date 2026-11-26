/**
 * Who may register as what, from which web origins, and who may sign in. Pure rules, so they are tested on their own
 * (authPolicy.test.ts) and every auth route applies the same ones.
 */

/**
 * The roles anyone can choose at sign-up. `admin` is deliberately not one of them: platform admins are developers and
 * operators, granted by hand with scripts/grant-admin.ts, never through the public registration form.
 */
export const SELF_REGISTER_ROLES = ['enterprise', 'worker'] as const;
export type SelfRegisterRole = (typeof SELF_REGISTER_ROLES)[number];

/** The role a registration asked for, or null when it is not one anyone may choose. No role given means worker. */
export function selfRegisterRole(requested: unknown): SelfRegisterRole | null {
  if (requested === undefined || requested === null || requested === '') return 'worker';
  return (SELF_REGISTER_ROLES as readonly unknown[]).includes(requested) ? (requested as SelfRegisterRole) : null;
}

/**
 * The web origins passkeys may be created and used on: the dashboard and the admin console. From RP_ORIGINS
 * (comma-separated), else RP_ORIGIN plus the local admin console. The first is the default when a client names none.
 */
export function rpOrigins(env: { RP_ORIGINS?: string; RP_ORIGIN?: string } = process.env): string[] {
  const listed = (env.RP_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const origins = listed.length ? listed : [env.RP_ORIGIN || 'http://localhost:3100', 'http://localhost:3200'];
  return [...new Set(origins)];
}

/**
 * The origin a passkey request came from, only when it is one of ours. Passkeys are stored per origin, so the client's
 * origin selects the credential; it must never be trusted as is. None given means the default (first) origin.
 */
export function allowedOrigin(claimed: unknown, origins: string[]): string | null {
  if (claimed === undefined || claimed === null || claimed === '') return origins[0] ?? null;
  return typeof claimed === 'string' && origins.includes(claimed) ? claimed : null;
}

/** Why an account may not sign in or keep a session, or null when it may. */
export function signInRefusal(status: string | null | undefined): string | null {
  if (status === 'suspended') return 'This account is suspended. Contact support.';
  if (status === 'closed') return 'This account is closed';
  return null;
}
