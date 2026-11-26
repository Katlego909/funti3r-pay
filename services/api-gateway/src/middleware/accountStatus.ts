import { query } from '@funti3r/database';

const CACHE_MS = 5000;
const cache = new Map<string, { status: string | null; at: number }>();

/**
 * An account's status (active, suspended, closed), or null for an account that no longer exists. Read from the
 * database and remembered for 5 seconds, so suspending an account takes effect on every service within 5 seconds
 * instead of when its access token expires, without a database read on every request.
 */
export async function accountStatus(userId: string): Promise<string | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.status;
  const { rows } = await query<{ status: string }>('SELECT status FROM users WHERE id = $1', [userId]);
  const status = rows[0]?.status ?? null;
  if (cache.size > 10_000) cache.clear(); // bounded: a 5-second cache never needs to be large
  cache.set(userId, { status, at: Date.now() });
  return status;
}
