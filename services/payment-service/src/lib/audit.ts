import { audit as writeAudit, type AuditEntry } from '@funti3r/database';
import { metrics } from './metrics.js';

const writeFailures = metrics.counter('audit_write_failures_total', 'Audit events that could not be written');

/** The shared audit writer (@funti3r/database), counting failed writes on this service's metrics. */
export const audit = (entry: AuditEntry): Promise<boolean> => writeAudit(entry, { onFailure: () => writeFailures.inc() });
