import { decryptFromString, encryptToString, isEncryptedString } from '@funti3r/shared-utils';

/**
 * A KYC submission holds ID numbers, bank details and tax numbers. It is stored encrypted
 * (AES-256-GCM, the same helper that protects wallet keys) as one JSON string inside the
 * `data` column; rows written before this existed are plain objects and still read fine.
 */
export function sealDetails(details: Record<string, unknown>): string {
  return JSON.stringify(encryptToString(JSON.stringify(details)));
}

export function openDetails(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string' && isEncryptedString(raw)) return JSON.parse(decryptFromString(raw));
  return (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
}

export const isSealed = (raw: unknown): boolean => typeof raw === 'string' && isEncryptedString(raw);
