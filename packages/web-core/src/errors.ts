import { isAxiosError } from 'axios';

const OFFLINE_MESSAGE = "Can't reach Funti3rPay. Check your connection and try again.";

/**
 * The one way to turn a failed API call into text for the user. The services only ever send client-safe messages
 * (see errorHandler in shared-utils), so the server's `error` is shown as is; a server-side failure also carries a
 * request id, appended so support can find the exact log line. No response at all means the network, not the server.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  // Not an API call (a bug in our own code): its message is no help to the user.
  if (!isAxiosError(err)) return fallback;
  if (!err.response) return OFFLINE_MESSAGE;

  const data = err.response.data as { error?: unknown; requestId?: unknown } | undefined;
  const message = typeof data?.error === 'string' && data.error ? data.error : fallback;
  const ref = typeof data?.requestId === 'string' && err.response.status >= 500 ? ` · ref ${data.requestId.slice(0, 8)}` : '';
  return message + ref;
}
