import type { Request } from 'express';
import { verifyToken, extractToken } from '@funti3r/shared-utils';

/**
 * True when the request carries a valid access token issued to this user.
 *
 * Needed on the few public auth routes that behave differently for someone already signed in (the gateway does not
 * identify callers on public routes, so these check the token themselves).
 */
export function hasSessionFor(req: Pick<Request, 'headers'>, userId: string): boolean {
  try {
    return verifyToken(extractToken(req.headers.authorization ?? '')).userId === userId;
  } catch {
    return false;
  }
}
