import { createMetrics } from '@funti3r/shared-utils';

export const metrics = createMetrics('user-service');

/** Sign-in and registration outcomes: how often people get in, and how often they are turned away. */
export const authEventsTotal = metrics.counter('auth_events_total', 'Authentication events, by kind and outcome', ['kind', 'outcome']);
