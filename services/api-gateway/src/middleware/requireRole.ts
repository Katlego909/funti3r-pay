import type { Request, Response, NextFunction } from 'express';

/**
 * Lets a request through only when the role the auth middleware took from the verified token is one of `roles`.
 * Mount it AFTER authMiddleware: the role it reads is the one set from the token, never one the client sent.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.headers['x-user-role'];
    if (typeof role !== 'string' || !roles.includes(role)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }
    next();
  };
}
