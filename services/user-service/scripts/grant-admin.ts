/**
 * Grants or revokes platform admin: the only way anyone becomes a Funti3rPay admin (sign-up never offers the role).
 * Run by a developer with access to the database. Every change is written to the audit trail.
 *
 *   pnpm --filter @funti3r/user-service grant-admin -- --email ops@funti3r.xyz
 *   pnpm --filter @funti3r/user-service grant-admin -- --email ops@funti3r.xyz --revoke --to worker
 *
 * Use a dedicated account for admin work (register it as a worker first, then grant), not your company login: an admin
 * has no company. The change applies at the person's next token refresh, within 15 minutes.
 */
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { audit, closePostgres, query } from '@funti3r/database';
import { grantAdmin, revokeAdmin } from '../src/lib/adminGrant.js';

async function main() {
  // `pnpm grant-admin -- --email x` passes the `--` through: drop it, so the command works with or without it.
  const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
  const { values } = parseArgs({
    args,
    options: { email: { type: 'string' }, revoke: { type: 'boolean', default: false }, to: { type: 'string' } },
  });
  if (!values.email) throw new Error('Usage: grant-admin --email <email> [--revoke --to enterprise|worker]');
  const deps = { query, audit, operator: userInfo().username };

  const result = values.revoke
    ? await revokeAdmin(values.email, (values.to ?? '') as 'enterprise' | 'worker', deps)
    : await grantAdmin(values.email, deps);

  console.log(result.changed
    ? `${values.email}: ${result.from} -> ${result.to}. Takes effect at their next token refresh (within 15 minutes).`
    : `${values.email}: nothing changed (${result.reason}).`);
}

main().then(
  async () => { await closePostgres(); process.exit(0); },
  async (err) => { console.error(err instanceof Error ? err.message : err); await closePostgres().catch(() => {}); process.exit(1); },
);
