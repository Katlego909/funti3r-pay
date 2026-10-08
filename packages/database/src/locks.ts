import { createHash } from 'node:crypto';
import { createLogger } from '@funti3r/shared-utils';
import { getPostgres } from './postgres.js';

const logger = createLogger('Database:Locks');

/** Two 32-bit integers derived from a name: what Postgres advisory locks are keyed by. */
function lockKey(name: string): [number, number] {
  const h = createHash('sha256').update(name).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

/** How long a caller waits for a busy lock before giving up, so a stuck holder cannot freeze everyone behind it. */
const DEFAULT_WAIT_MS = 60_000;

/**
 * Runs `fn` while holding a cluster-wide lock called `name`; callers using the same name run one at a time, across
 * every process and instance sharing the database. The lock lives on a dedicated connection, so if the holder
 * crashes Postgres releases it. Use it to serialize things that must not overlap, e.g. submissions from one Stellar
 * account (two at once would reuse a sequence number and one would fail).
 */
export async function withAdvisoryLock<T>(name: string, fn: () => Promise<T>, waitMs = DEFAULT_WAIT_MS): Promise<T> {
  const [a, b] = lockKey(name);
  const client = await (await getPostgres()).connect();
  try {
    await client.query(`SET lock_timeout = ${Math.max(1, Math.floor(waitMs))}`);
    await client.query('SELECT pg_advisory_lock($1, $2)', [a, b]);
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [a, b]).catch((err) =>
        logger.error('Failed to release advisory lock', { name, error: String(err) }));
    }
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` only if nobody else holds the lock right now; otherwise returns `{ ran: false }` immediately.
 * For jobs that every instance schedules but only one should run per tick.
 */
export async function tryWithAdvisoryLock<T>(name: string, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
  const [a, b] = lockKey(name);
  const client = await (await getPostgres()).connect();
  try {
    const got = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1, $2) AS locked', [a, b]);
    if (!got.rows[0]?.locked) return { ran: false };
    try {
      return { ran: true, result: await fn() };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [a, b]).catch((err) =>
        logger.error('Failed to release advisory lock', { name, error: String(err) }));
    }
  } finally {
    client.release();
  }
}
