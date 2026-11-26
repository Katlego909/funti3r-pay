/**
 * What a platform admin sees of a KYC submission by default: enough to review it (names, nationality, countries, the
 * kind of ID, the bank's name, any sanctions match) with the identifying numbers masked to their last four characters.
 * The full record takes a deliberate, audited reveal (POST /:userId/reveal).
 */

/**
 * Fields that identify a person or an account. Matched by name in any section (or stored flat), because submissions
 * have not always used the same shape: an ID number has lived under both `identity` and `governmentId`.
 */
const IDENTIFYING = new Set(['dateOfBirth', 'idNumber', 'streetAddress', 'postalCode', 'taxId', 'accountNumber', 'iban']);

/** A value with all but its last four characters hidden; short values are hidden whole. */
export function maskValue(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return value;
  return value.length > 4 ? `•••• ${value.slice(-4)}` : '••••';
}

const isSection = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A copy of the submission with every identifying field masked. The stored record is never changed. */
export function maskForReview(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [
    key,
    isSection(value)
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, IDENTIFYING.has(k) ? maskValue(v) : v]))
      : IDENTIFYING.has(key) ? maskValue(value) : value,
  ]));
}
