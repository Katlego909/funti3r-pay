import { createLogger, getLogContext } from '@funti3r/shared-utils';
import { query } from './postgres.js';

const logger = createLogger('Database:Audit');

export interface AuditEntry {
  actorId?: string | null;
  /** Who acted: enterprise, worker, admin, or developer (a script run by hand). */
  actorRole: string;
  /** What happened, as `<area>.<verb>`: escrow.created, payout.completed, admin.granted … */
  action: string;
  /** What it happened to: escrow, milestone, payment, cashout, user, company … */
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
}

/**
 * Appends one row to the append-only audit trail (audit_events, migration 025), tagged with the request it happened in.
 * It runs AFTER the action it records, and a failed write never undoes or blocks what already happened: it is logged
 * loudly and reported through `onFailure` (each service counts it as audit_write_failures_total, which has an alert).
 * `run` is the query function to write with; tests pass their mock.
 */
export async function audit(
  entry: AuditEntry,
  opts: { onFailure?: () => void; run?: typeof query } = {},
): Promise<void> {
  try {
    await (opts.run ?? query)(
      `INSERT INTO audit_events (actor_id, actor_role, action, entity_type, entity_id, detail, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.actorId ?? null, entry.actorRole, entry.action, entry.entityType, entry.entityId,
        entry.detail ? JSON.stringify(entry.detail) : null, getLogContext()?.requestId ?? null,
      ],
    );
  } catch (err) {
    opts.onFailure?.();
    logger.error('Failed to write an audit event', { action: entry.action, entityId: entry.entityId, error: String(err) });
  }
}
