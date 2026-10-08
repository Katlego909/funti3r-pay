import { randomUUID } from 'node:crypto';
import { createLogger, runWithLogContext } from './logger.js';

interface Req { method: string; path: string; originalUrl?: string; headers: Record<string, string | string[] | undefined>; route?: { path?: unknown } }
interface Res {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  on(event: 'finish', listener: () => void): unknown;
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Probes and scrapes arrive every few seconds; logging each one would bury the real traffic. */
const QUIET_PATHS = new Set(['/health', '/health/live', '/health/ready', '/metrics']);

/**
 * Express middleware for a service behind the gateway. Gives everything run for this request a log context (request id
 * from the gateway, or a fresh one; the user from the gateway-signed identity, so mount it AFTER requireGatewayIdentity),
 * echoes the id back as `x-request-id`, and writes one access-log line per request with its route, status and duration.
 */
export function requestContext(service: string, onFinish?: (info: { method: string; route: string; status: number; seconds: number }) => void) {
  const logger = createLogger(service);
  return (req: Req, res: Res, next: () => void): void => {
    const requestId = first(req.headers['x-request-id']) || randomUUID();
    res.setHeader('x-request-id', requestId);
    const started = process.hrtime.bigint();

    runWithLogContext({ requestId, userId: first(req.headers['x-user-id']), role: first(req.headers['x-user-role']) }, () => {
      res.on('finish', () => {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        // The route pattern (/payouts/:id), not the URL, so ids never become metric labels or fill a log index.
        const route = typeof req.route?.path === 'string' ? req.route.path : req.path;
        onFinish?.({ method: req.method, route, status: res.statusCode, seconds });
        if (QUIET_PATHS.has(req.path)) return;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger[level]('request', { method: req.method, route, status: res.statusCode, ms: Math.round(seconds * 1000) });
      });
      next();
    });
  };
}
