import jwt, { SignOptions } from 'jsonwebtoken';
import { JwtPayload, UserRole } from '@funti3r/shared-types';

const JWT_SECRET: string = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRATION: string = process.env.JWT_EXPIRATION || '24h';

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
    JWT_SECRET,
    { expiresIn: JWT_EXPIRATION } as SignOptions
  );
}

export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, JWT_SECRET, {}) as JwtPayload;
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
