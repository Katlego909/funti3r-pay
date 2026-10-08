import { createMetrics } from '@funti3r/shared-utils';

export const metrics = createMetrics('payment-service');

/** Every payout that finished, by how it ended (completed, pending_claim, failed). */
export const payoutsTotal = metrics.counter('payouts_total', 'Payouts finished, by outcome', ['status']);

/** MoneyGram cash-outs: paid, refused before any money moved, or failed after we tried to pay. */
export const cashoutsTotal = metrics.counter('cashouts_total', 'MoneyGram cash-outs, by outcome', ['outcome']);

/** Scheduled jobs: ran, skipped because another instance had the lock, or failed. */
export const jobRunsTotal = metrics.counter('scheduler_job_runs_total', 'Scheduled job runs, by outcome', ['job', 'outcome']);
/** Money in limbo, refreshed every minute from the database: these should sit at 0, and an alert fires when they do not. */
export const stuckCashouts = metrics.gauge('cashouts_stuck', 'MoneyGram cash-outs paid but not acknowledged for over 15 minutes');
export const stuckPayments = metrics.gauge('payments_stuck', 'Payments still initiated or processing after more than 10 minutes');

export const jobSeconds = metrics.histogram('scheduler_job_duration_seconds', 'Scheduled job duration in seconds', ['job'], [0.1, 0.5, 1, 5, 15, 60, 300]);
