import { createHmac } from 'node:crypto';

/**
 * A fake passkey credential id for an email that has no passkey on this origin, so login answers the same way whether
 * or not the account exists. Keyed with a server secret, so nobody can tell it from a real id, and stable per email
 * and origin, so asking twice does not give it away. Same shape as a real id: 32 bytes, base64url.
 */
export function decoyCredentialId(email: string, origin: string, secret = process.env.JWT_SECRET ?? ''): string {
  return createHmac('sha256', secret).update(`passkey-login-decoy:${email}:${origin}`).digest('base64url');
}
