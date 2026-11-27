/**
 * Building blocks for the admin console's paged, filtered lists, shared by every service that serves one: a page
 * window read from query-string values, and a WHERE clause put together from optional conditions.
 */

export const MAX_PAGE = 200;
const DEFAULT_PAGE = 50;

/** A page window from query-string values: at most 200 rows, the first 50 when nothing is asked for. */
export function pageOf(q: { limit?: unknown; offset?: unknown }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(q.limit) || DEFAULT_PAGE, 1), MAX_PAGE);
  const offset = Math.max(Math.floor(Number(q.offset)) || 0, 0);
  return { limit, offset };
}

/**
 * A WHERE clause from optional conditions, each written with one `?` for its value: null entries are skipped and the
 * rest are numbered $1, $2… in order. `start` numbers from a later parameter when others come first.
 */
export function where(conds: Array<[string, unknown] | null | undefined | false>, start = 0): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts = conds.filter((c): c is [string, unknown] => !!c).map(([clause, value]) => {
    params.push(value);
    return clause.replace('?', `$${start + params.length}`);
  });
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

/** `value` when it is one of `allowed`, otherwise undefined: an unknown filter value is ignored, never queried. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
