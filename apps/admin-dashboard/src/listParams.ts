import { useSearchParams } from 'react-router-dom';

/**
 * A list page's filters and page live in the URL, so a filtered view can be shared, reloaded or opened from a link
 * (the Overview's "Failed payouts" card opens Money already filtered).
 */

/**
 * The URL after a filter change: empty values are removed, and any change other than paging goes back to the first
 * page (a new filter's results start at the top).
 */
export function withPatch(current: URLSearchParams, patch: Record<string, string | null | undefined>): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  if (!('offset' in patch)) next.delete('offset');
  return next;
}

export function useListParams() {
  const [params, setParams] = useSearchParams();
  const offset = Math.max(Number(params.get('offset')) || 0, 0);
  return {
    get: (key: string) => params.get(key) ?? '',
    offset,
    set: (patch: Record<string, string | null | undefined>) => setParams(withPatch(params, patch)),
    /** Replaces every filter at once (a tab change). */
    reset: (next: Record<string, string>) => setParams(next),
  };
}
