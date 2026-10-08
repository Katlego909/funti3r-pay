import { query } from '@funti3r/database';
import { createLogger, getLogContext } from '@funti3r/shared-utils';
import { metrics } from './metrics.js';

const logger = createLogger('Audit');
const writeFailures = metrics.counter('audit_write_failures_total', 'Audit events that could not be written');

export interface AuditEntry {
  actorId?: string | null;
  actorRole: string;
  /** What happened, as `<area>.<verb>`: escrow.created, escrow.milestone_approved, payout.completed … */
  action: string;
  entityType: 'escrow' | 'milestone' | 'payment' | 'cashout';
  entityId: string;
  detail?: Record<string, unknown>;
}

/**
 * Appends one row to the audit trail (audit_events), tagged with the request it happened in. It runs AFTER the action
 * it records, and a failure to write never undoes or blocks money that already moved: it is logged loudly and counted
 * (audit_write_failures_total), which has an alert on it.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_events (actor_id, actor_role, action, entity_type, entity_id, detail, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.actorId ?? null, entry.actorRole, entry.action, entry.entityType, entry.entityId,
        entry.detail ? JSON.stringify(entry.detail) : null, getLogContext()?.requestId ?? null,
      ],
    );
  } catch (err) {
    writeFailures.inc();
    logger.error('Failed to write an audit event', { action: entry.action, entityId: entry.entityId, error: String(err) });
  }
}
