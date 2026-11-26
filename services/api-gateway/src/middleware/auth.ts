import type { Request, Response, NextFunction } from 'express';
import { verifyToken, stampIdentity, getLogContext, signInRefusal, createLogger } from '@funti3r/shared-utils';
import { accountStatus as readAccountStatus } from './accountStatus.js';

const logger = createLogger('APIGateway');

// The only auth endpoints reachable before a JWT exists. Explicit and
// exhaustive on purpose — unlike a `startsWith('/auth/')` prefix check, this
// can't silently make a future (or leftover debug) route under /auth/ public.
const PUBLIC_AUTH_ENDPOINTS = [
  '/register/start',
  '/register/finish',
  '/login/start',
  '/login/finish',
  '/dev-login',
  '/refresh',
  '/logout',
  '/recovery/start',
  '/recovery/verify',
];

const PUBLIC_PATHS = new Set([
  '/health',
  '/status',
  ...PUBLIC_AUTH_ENDPOINTS.map((p) => `/auth${p}`),
]);

// GET /invites/:token (and its company-invite equivalent) is a read-only
// invite preview shown to a brand-new visitor who has no session yet (they
// clicked a link from an email) — possession of the unguessable token is the
// authorization, same as a password-reset link. Only the single-segment
// token GET is public; creating/listing/accepting an invite still requires a
// real session.
const PUBLIC_GET_PATTERNS = [
  /^\/invites\/[^/]+$/,
  /^\/company\/invites\/[^/]+$/,
];

function isPublic(path: string, method: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (method === 'GET' && PUBLIC_GET_PATTERNS.some((p) => p.test(path))) return true;
  return false;
}

/**
 * Verifies the access token, then checks the account is still allowed in: a suspended, closed or deleted account is
 * refused here on every request, so no service keeps serving it until its token expires. When the status cannot be
 * read the request is refused (fail closed), never let through.
 */
export function createAuthMiddleware(accountStatus: (userId: string) => Promise<string | null> = readAccountStatus) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (isPublic(req.path, req.method)) return next();

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or malformed Authorization header' });
      return;
    }

    let payload: ReturnType<typeof verifyToken>;
    try {
      payload = verifyToken(authHeader.slice(7));
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    let status: string | null;
    try {
      status = await accountStatus(payload.userId);
    } catch (err) {
      logger.error('Account status check failed', { error: String(err) });
      res.status(503).json({ error: 'Service temporarily unavailable' });
      return;
    }
    if (status === null) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    const refusal = signInRefusal(status);
    if (refusal) {
      res.status(403).json({ error: refusal, code: `ACCOUNT_${status.toUpperCase()}` });
      return;
    }

    // Forward user identity to downstream services. x-company-id is always set-or-cleared (never left as whatever the
    // client sent) so a caller can't spoof company scope by attaching their own header when their JWT has no companyId.
    req.headers['x-user-id'] = payload.userId;
    req.headers['x-user-role'] = payload.role;
    req.headers['x-user-email'] = payload.email;
    if (payload.companyId) {
      req.headers['x-company-id'] = payload.companyId;
    } else {
      delete req.headers['x-company-id'];
    }
    // Sign it: services only believe identity headers that carry the gateway's signature.
    stampIdentity(req.headers);
    // From here on, every log line for this request names the signed-in user.
    const log = getLogContext();
    if (log) { log.userId = payload.userId; log.role = payload.role; }
    next();
  };
}
