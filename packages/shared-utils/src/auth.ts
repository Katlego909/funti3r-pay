import jwt from 'jsonwebtoken';
import { JwtPayload, UserRole } from '@funti3r/shared-types';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '24h';

export function generateToken(
  userId: string,
  email: string,
  role: UserRole
): string {
  return jwt.sign(
    { userId, email, role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRATION }
  );
}

export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
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
