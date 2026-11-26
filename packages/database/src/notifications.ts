import { createLogger } from '@funti3r/shared-utils';
import { query } from './postgres.js';

const logger = createLogger('Database:Notifications');

export interface Notification {
  userId: string;
  /** e.g. 'payment_failed', 'worker_joined'; the dashboard picks the icon and link from it. */
  type: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
}

/** The statement that saves a notification. */
function notificationInsert(n: Notification): [string, unknown[]] {
  return [
    `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [n.userId, n.type, n.title, n.body, n.entityType ?? null, n.entityId ?? null],
  ];
}

/**
 * Puts a message in a user's in-app inbox. Best-effort: a notification never fails the action it reports, so errors
 * are logged, not thrown. Call it AFTER the action's own transaction has committed, never inside one: in Postgres a
 * failed statement aborts the whole transaction, so a failed insert there would silently undo the action itself.
 * `run` is the query function to save with; tests pass their mock.
 */
export async function notify(n: Notification, run: typeof query = query): Promise<void> {
  try {
    await run(...notificationInsert(n));
  } catch (err) {
    logger.warn('Could not save a notification', { type: n.type, userId: n.userId, error: String(err) });
  }
}
