/**
 * One-time migration: encrypt any plaintext users.stellar_secret_key values
 * at rest. Idempotent — already-encrypted rows (enc:v1: prefix) are skipped.
 *
 * Run from services/user-service:
 *   node --env-file=../../.env.local --import tsx scripts/encrypt-stellar-secrets.ts
 */
import { initPostgres, query } from '@funti3r/database';
import { encryptToString, isEncryptedString } from '@funti3r/shared-utils';

async function main() {
  await initPostgres();

  const res = await query(
    'SELECT id, email, stellar_secret_key FROM users WHERE stellar_secret_key IS NOT NULL',
  );

  let migrated = 0;
  let alreadyEncrypted = 0;
  for (const row of res.rows as Array<{ id: string; email: string; stellar_secret_key: string }>) {
    if (isEncryptedString(row.stellar_secret_key)) {
      alreadyEncrypted++;
      continue;
    }
    const encrypted = encryptToString(row.stellar_secret_key);
    await query('UPDATE users SET stellar_secret_key = $1, updated_at = NOW() WHERE id = $2', [
      encrypted,
      row.id,
    ]);
    migrated++;
    console.log(`  encrypted secret for ${row.email}`);
  }

  console.log(`\nDone. Encrypted ${migrated} secret(s); ${alreadyEncrypted} already encrypted.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
