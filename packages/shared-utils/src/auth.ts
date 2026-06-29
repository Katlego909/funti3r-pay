import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { JwtPayload, UserRole } from '@funti3r/shared-types';

const JWT_SECRET: string = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRATION: string = process.env.JWT_EXPIRATION || '24h';

export function generateToken(
  payload: { userId: string; email: string; role: UserRole } | string,
  expirationOverride?: string
): string {
  const tokenPayload = typeof payload === 'string' ? { userId: payload } : payload;
  const expiration = expirationOverride || JWT_EXPIRATION;

  return jwt.sign(
    tokenPayload,
    JWT_SECRET,
    { expiresIn: expiration } as SignOptions
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

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
