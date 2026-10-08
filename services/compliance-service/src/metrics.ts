import { createMetrics } from '@funti3r/shared-utils';

export const metrics = createMetrics('compliance-service');

/** KYC decisions as they are recorded in the audit trail (submitted, approved, rejected, flag_cleared, rescreened…). */
export const kycEventsTotal = metrics.counter('kyc_events_total', 'KYC audit events, by action', ['action']);

/** When the sanctions list in use was downloaded (unix seconds), and how many entries it holds; alert when it goes stale. */
export const sanctionsFetchedAt = metrics.gauge('sanctions_list_fetched_timestamp_seconds', 'When the loaded sanctions list was downloaded');
export const sanctionsEntries = metrics.gauge('sanctions_list_entries', 'Entries in the loaded sanctions list');
