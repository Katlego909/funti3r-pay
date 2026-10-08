/**
 * Re-encrypts everything stored under the master key onto the current key, so a retired or leaked key can be
 * dropped. Safe to run repeatedly: values already on the current key are skipped.
 *
 * How to rotate:
 *   1. Generate a new key:  openssl rand -hex 32
 *   2. In the environment:  MASTER_ENCRYPTION_KEYS_OLD="k1:<old hex>"   (add the old key; keep it until step 5)
 *                           MASTER_ENCRYPTION_KEY=<new hex>   MASTER_ENCRYPTION_KEY_ID=k2
 *   3. Back up the database (scripts/ops/backup.sh), then:
 *        node --env-file=../../.env.local --import tsx scripts/rotate-keys.ts           (dry run: counts only)
 *        node --env-file=../../.env.local --import tsx scripts/rotate-keys.ts --apply   (does it)
 *   4. Restart the services; everything now decrypts with k2.
 *   5. Once no database or backup you may restore still holds k1 values, remove MASTER_ENCRYPTION_KEYS_OLD.
 *
 * Every re-encrypted value is decrypted again with the new key and compared to the original before the table's
 * transaction commits; a mismatch aborts that table untouched.
 */
import { initPostgres, closePostgres, transaction } from '@funti3r/database';
import {
  currentKeyId, decryptFromString, decryptWithRing, encryptSecret, encryptToString, isCurrentKeyEncrypted, isEncryptedString,
} from '@funti3r/shared-utils';
import { openDetails, sealDetails } from '../../compliance-service/src/pii.js';

const apply = process.argv.includes('--apply');

interface Counts { checked: number; rotated: number; skipped: number }
const fresh = (): Counts => ({ checked: 0, rotated: 0, skipped: 0 });

/** users.stellar_secret_key and enterprises.stellar_secret_key: one "enc:v…" string per row. */
async function rotateStringColumn(table: 'users' | 'enterprises', column: 'stellar_secret_key'): Promise<Counts> {
  const counts = fresh();
  await transaction(async (client) => {
    const rows = await client.query(`SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL FOR UPDATE`);
    for (const row of rows.rows as Array<{ id: string; value: string }>) {
      counts.checked++;
      if (!isEncryptedString(row.value) || isCurrentKeyEncrypted(row.value)) { counts.skipped++; continue; }
      const plaintext = decryptFromString(row.value);
      const next = encryptToString(plaintext);
      if (decryptFromString(next) !== plaintext) throw new Error(`${table}.${column} ${row.id}: re-encryption did not round-trip`);
      if (apply) await client.query(`UPDATE ${table} SET ${column} = $2 WHERE id = $1`, [row.id, next]);
      counts.rotated++;
    }
  });
  return counts;
}

/** kyc_records.data: a JSON string holding one encrypted submission. */
async function rotateKyc(): Promise<Counts> {
  const counts = fresh();
  await transaction(async (client) => {
    const rows = await client.query(`SELECT id, data FROM kyc_records WHERE data IS NOT NULL FOR UPDATE`);
    for (const row of rows.rows as Array<{ id: string; data: unknown }>) {
      counts.checked++;
      if (typeof row.data !== 'string' || isCurrentKeyEncrypted(row.data)) { counts.skipped++; continue; }
      const details = openDetails(row.data);
      const next = sealDetails(details);
      if (JSON.stringify(openDetails(JSON.parse(next))) !== JSON.stringify(details)) throw new Error(`kyc_records ${row.id}: re-encryption did not round-trip`);
      if (apply) await client.query(`UPDATE kyc_records SET data = $2 WHERE id = $1`, [row.id, next]);
      counts.rotated++;
    }
  });
  return counts;
}

/** wallets: ciphertext, iv, tag and salt in separate columns, with no key id. */
async function rotateWallets(): Promise<Counts> {
  const counts = fresh();
  await transaction(async (client) => {
    const rows = await client.query(
      `SELECT id, encrypted_secret, encryption_iv, encryption_tag, encryption_salt FROM wallets WHERE encrypted_secret IS NOT NULL FOR UPDATE`,
    );
    for (const row of rows.rows as Array<{ id: string; encrypted_secret: string; encryption_iv: string; encryption_tag: string; encryption_salt: string }>) {
      counts.checked++;
      const { plaintext, keyId } = decryptWithRing({
        ciphertext: row.encrypted_secret, iv: row.encryption_iv, tag: row.encryption_tag, salt: row.encryption_salt,
      });
      if (keyId === currentKeyId()) { counts.skipped++; continue; }
      const next = encryptSecret(plaintext);
      if (decryptWithRing(next).plaintext !== plaintext) throw new Error(`wallets ${row.id}: re-encryption did not round-trip`);
      if (apply) {
        await client.query(
          `UPDATE wallets SET encrypted_secret = $2, encryption_iv = $3, encryption_tag = $4, encryption_salt = $5 WHERE id = $1`,
          [row.id, next.ciphertext, next.iv, next.tag, next.salt],
        );
      }
      counts.rotated++;
    }
  });
  return counts;
}

async function main() {
  console.log(`Key rotation to "${currentKeyId()}" (${apply ? 'APPLYING' : 'dry run: pass --apply to change anything'})`);
  await initPostgres();
  const report: Record<string, Counts> = {
    'users.stellar_secret_key': await rotateStringColumn('users', 'stellar_secret_key'),
    'enterprises.stellar_secret_key': await rotateStringColumn('enterprises', 'stellar_secret_key'),
    'kyc_records.data': await rotateKyc(),
    'wallets.encrypted_secret': await rotateWallets(),
  };
  console.table(report);
  await closePostgres();
}

main().catch(async (err) => {
  console.error('Rotation failed; nothing was changed in the table that failed:', err instanceof Error ? err.message : err);
  await closePostgres().catch(() => {});
  process.exit(1);
});
