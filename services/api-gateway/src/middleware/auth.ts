import type { Request, Response, NextFunction } from 'express';
import { verifyToken, AuthenticationError } from '@funti3r/shared-utils';

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
  ...PUBLIC_AUTH_ENDPOINTS.map((p) => `/api/auth${p}`),
]);

// GET /invites/:token (and its company-invite equivalent) is a read-only
// invite preview shown to a brand-new visitor who has no session yet (they
// clicked a link from an email) — possession of the unguessable token is the
// authorization, same as a password-reset link. Only the single-segment
// token GET is public; creating/listing/accepting an invite still requires a
// real session.
const PUBLIC_GET_PATTERNS = [
  /^\/invites\/[^/]+$/,
  /^\/api\/invites\/[^/]+$/,
  /^\/company\/invites\/[^/]+$/,
  /^\/api\/company\/invites\/[^/]+$/,
];

function isPublic(path: string, method: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (method === 'GET' && PUBLIC_GET_PATTERNS.some((p) => p.test(path))) return true;
  return false;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isPublic(req.path, req.method)) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    // Forward user identity to downstream services. x-company-id is always
    // set-or-cleared (never left as whatever the client sent) so a caller
    // can't spoof company scope by attaching their own header when their
    // JWT carries no companyId.
    req.headers['x-user-id'] = payload.userId;
    req.headers['x-user-role'] = payload.role;
    req.headers['x-user-email'] = payload.email;
    if (payload.companyId) {
      req.headers['x-company-id'] = payload.companyId;
    } else {
      delete req.headers['x-company-id'];
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
