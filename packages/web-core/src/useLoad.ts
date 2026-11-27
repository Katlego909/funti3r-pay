import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorKind, apiErrorMessage, type ApiErrorKind } from './errors.js';

/** A screen's data and every state it can be in, the same way in every app. */
export interface Loaded<T> {
  data: T | null;
  /** The message to show when loading failed (already user-safe), or null. */
  error: string | null;
  /** What kind of failure it was, so the screen can say "you're offline" or "no access" instead of a generic error. */
  errorKind: ApiErrorKind | null;
  /** The first load: nothing to show yet, so the screen shows a placeholder. */
  loading: boolean;
  /** A reload while the previous data stays on screen (a refresh, a filter change). */
  refreshing: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads data for a screen and tracks its state. `deps` work like a useEffect's: when they change it loads again.
 * A list keeps its rows on screen while new ones load (so it never blanks); a record view passes
 * `{ resetOnChange: true }` so it never shows the previous record under the next one's title. A response that
 * arrives after a newer request started is ignored, so a slow answer can't overwrite a newer one.
 */
export function useLoad<T>(
  load: () => Promise<T>,
  deps: unknown[],
  { fallbackError = 'Could not load this', resetOnChange = false }: { fallbackError?: string; resetOnChange?: boolean } = {},
): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ message: string; kind: ApiErrorKind } | null>(null);
  const [inFlight, setInFlight] = useState(true);
  const latest = useRef(0);

  // The caller lists what the load depends on, like a useEffect.
  const run = useCallback(load, deps);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    setInFlight(true);
    try {
      const value = await run();
      if (request !== latest.current) return;
      setData(value);
      setError(null);
    } catch (err) {
      if (request !== latest.current) return;
      setError({ message: apiErrorMessage(err, fallbackError), kind: apiErrorKind(err) });
    } finally {
      if (request === latest.current) setInFlight(false);
    }
  }, [run, fallbackError]);

  useEffect(() => {
    if (resetOnChange) { setData(null); setError(null); }
    void reload();
  }, [reload, resetOnChange]);

  return {
    data,
    error: error?.message ?? null,
    errorKind: error?.kind ?? null,
    loading: inFlight && data === null,
    refreshing: inFlight && data !== null,
    reload,
  };
}
