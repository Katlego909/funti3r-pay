import type { Query } from './deps.js';
import { isSealed, sealDetails } from './pii.js';

/**
 * Encrypts KYC submissions written before encryption existed. Safe to run on every boot:
 * rows already sealed are skipped, so it settles to a no-op.
 */
export async function sealExistingRecords(query: Query): Promise<number> {
  const rows = await query(`SELECT id, data FROM kyc_records WHERE data IS NOT NULL`);
  let sealed = 0;
  for (const row of rows.rows) {
    if (isSealed(row.data)) continue;
    await query(`UPDATE kyc_records SET data = $2 WHERE id = $1`, [row.id, sealDetails(row.data ?? {})]);
    sealed++;
  }
  return sealed;
}
