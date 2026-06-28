import type { Request, Response, NextFunction } from 'express';
import { verifyToken, AuthenticationError } from '@funti3r/shared-utils';

const PUBLIC_PATHS = new Set([
  '/health',
  '/status',
  '/auth/register/start',
  '/auth/register/finish',
  '/auth/login/start',
  '/auth/login/finish',
  '/auth/refresh',
  '/auth/logout',
]);

function isPublic(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith('/auth/')) return true;
  if (path.startsWith('/api/auth/')) return true;
  return false;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isPublic(req.path)) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    // Forward user identity to downstream services
    req.headers['x-user-id'] = payload.userId;
    req.headers['x-user-role'] = payload.role;
    req.headers['x-user-email'] = payload.email;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
