import type { Query } from './deps.js';
import { kycEventsTotal } from './metrics.js';

export type KycAction = 'submitted' | 'approved' | 'rejected' | 'flag_cleared' | 'rescreened' | 'expired';

/** Appends one row to the KYC audit trail. `actorId` is null for the system (screening jobs). */
export async function recordKycEvent(
  query: Query,
  e: { userId: string; actorId: string | null; actorRole: string; action: KycAction; detail?: Record<string, unknown> },
): Promise<void> {
  await query(
    `INSERT INTO kyc_events (user_id, actor_id, actor_role, action, detail) VALUES ($1, $2, $3, $4, $5)`,
    [e.userId, e.actorId, e.actorRole, e.action, e.detail ? JSON.stringify(e.detail) : null],
  );
  kycEventsTotal.inc({ action: e.action });
}
