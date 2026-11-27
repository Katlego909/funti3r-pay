import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '@funti3r/web-core';

/** Loads data for a page: the value, the error text, whether it is loading, and a reload for after an action. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The caller lists what the load depends on, like a useEffect.
  const run = useCallback(load, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load this'));
    } finally {
      setLoading(false);
    }
  }, [run]);

  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}
