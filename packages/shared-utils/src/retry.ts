/**
 * Retries a read that is safe to repeat when it fails for a reason that may pass: no response at all (timeout, dropped
 * connection), a 5xx or a 429. A 4xx is an answer, not an outage, so it is rethrown at once. Backoff doubles from
 * `baseMs`. Never wrap a call that moves money or changes state: repeating those is how payments go out twice.
 */
export async function retryRead<T>(fn: () => Promise<T>, { attempts = 3, baseMs = 200 } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isTransient(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** (attempt - 1)));
    }
  }
}

function isTransient(err: unknown): boolean {
  const status: number | undefined = (err as { response?: { status?: number } })?.response?.status;
  return status === undefined || status >= 500 || status === 429;
}
