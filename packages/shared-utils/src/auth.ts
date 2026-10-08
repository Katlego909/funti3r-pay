import jwt, { SignOptions } from 'jsonwebtoken';
import { JwtPayload, UserRole } from '@funti3r/shared-types';

const JWT_ALGORITHM = 'HS256';

/**
 * The signing secret must come from the environment everywhere except the unit tests: a built-in fallback is a
 * secret anyone who has read the source can use to mint a token for any user.
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    if (secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
    return secret;
  }
  if (process.env.NODE_ENV === 'test') return 'test-only-jwt-secret-not-for-any-real-environment';
  throw new Error('JWT_SECRET must be set');
}

// Resolved on first use, so a service that never signs or verifies a token does not need the secret at all.
let cachedSecret: string | undefined;
const jwtSecret = (): string => (cachedSecret ??= resolveJwtSecret());

/** Call at start in the services that sign or verify tokens, so a missing secret stops the boot, not the first login. */
export function assertJwtConfigured(): void {
  if (process.env.NODE_ENV !== 'test') jwtSecret();
}
const JWT_EXPIRATION: string = process.env.JWT_EXPIRATION || '15m';

export function generateToken(
  userId: string,
  email: string,
  role: UserRole,
  companyId?: string
): string {
  // jwt.sign's payload is JSON-serialized, which drops undefined-valued keys
  // the same way JSON.stringify does — no need to branch on companyId here.
  return jwt.sign(
    { userId, email, role, companyId },
    jwtSecret(),
    { expiresIn: JWT_EXPIRATION, algorithm: JWT_ALGORITHM } as SignOptions
  );
}

export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, jwtSecret(), { algorithms: [JWT_ALGORITHM] }) as JwtPayload;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

export function extractToken(authHeader: string): string {
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw new Error('Invalid authorization header');
  }
  return parts[1];
}
