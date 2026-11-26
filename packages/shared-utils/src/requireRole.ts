interface Req { headers: Record<string, string | string[] | undefined> }
interface Res { status(code: number): { json(body: unknown): unknown } }

/**
 * Lets a request through only when its role is one of `roles`. The role is the one the gateway took from the verified
 * token: at the gateway, mount this AFTER authMiddleware; in a service, after requireGatewayIdentity, which rejects
 * identity headers the gateway did not sign. The one check for role-gated routes everywhere (e.g. requireRole('admin')).
 */
export function requireRole(...roles: string[]) {
  return (req: Req, res: Res, next: () => void): void => {
    const role = req.headers['x-user-role'];
    if (typeof role !== 'string' || !roles.includes(role)) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }
    next();
  };
}
