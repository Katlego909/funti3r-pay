import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Who is calling, as vouched for by the API gateway.
 *
 * The gateway verifies the user's JWT once and forwards the identity as `x-user-*` headers; downstream services
 * trust those headers. A bare header proves nothing to a service that someone can reach directly, so the gateway
 * also signs them (HMAC-SHA256 with a secret only the platform's services share, plus a timestamp against replay),
 * and every service verifies the signature before believing the headers. A request that carries identity headers
 * without a valid signature is rejected, so a forged `x-user-role: admin` sent straight to a service goes nowhere.
 * Requests with no identity headers at all (public routes, calls between services) pass through as anonymous.
 */

/** The headers the gateway sets from the verified JWT. */
export const IDENTITY_HEADERS = ['x-user-id', 'x-user-role', 'x-user-email', 'x-company-id'] as const;
const TS_HEADER = 'x-gateway-ts';
const SIG_HEADER = 'x-gateway-sig';
/** A signature older than this is refused, so a captured request cannot be replayed later. */
const MAX_AGE_MS = 60_000;

type Headers = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export function internalAuthSecret(): string {
  const secret = process.env.INTERNAL_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('INTERNAL_AUTH_SECRET must be set to at least 32 characters');
  }
  return secret;
}

/** Call once at service start: a service that cannot verify the gateway's signature must not boot half-open. */
export function assertInternalAuthConfigured(): void {
  if (process.env.NODE_ENV !== 'test') internalAuthSecret();
}

function sign(headers: Headers, ts: string, secret: string): string {
  const parts = [...IDENTITY_HEADERS.map((h) => first(headers[h])), ts];
  return createHmac('sha256', secret).update(parts.join('\n')).digest('hex');
}

/** Gateway side: remove anything a client sent that looks like platform-set identity. */
export function stripIdentity(headers: Headers): void {
  for (const h of [...IDENTITY_HEADERS, TS_HEADER, SIG_HEADER]) delete headers[h];
}

/** Gateway side: sign the identity headers already set from the verified token. */
export function stampIdentity(headers: Headers, now = Date.now(), secret = internalAuthSecret()): void {
  const ts = String(now);
  headers[TS_HEADER] = ts;
  headers[SIG_HEADER] = sign(headers, ts, secret);
}

export function hasIdentity(headers: Headers): boolean {
  return IDENTITY_HEADERS.some((h) => first(headers[h]) !== '');
}

/** Service side: is the identity in these headers vouched for by the gateway? */
export function verifyIdentity(headers: Headers, now = Date.now(), secret = internalAuthSecret()): boolean {
  const ts = first(headers[TS_HEADER]);
  const sig = first(headers[SIG_HEADER]);
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(now - Number(ts)) > MAX_AGE_MS) return false;
  const expected = Buffer.from(sign(headers, ts, secret), 'hex');
  const given = Buffer.from(sig, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface Req { headers: Headers }
interface Res { status(code: number): { json(body: unknown): unknown } }

/**
 * Express middleware for every service behind the gateway. Identity headers must carry the gateway's signature;
 * a request without any identity headers is anonymous and goes on to the route's own checks.
 * `enforce` defaults on everywhere except the unit tests, which call routes directly with bare headers.
 */
export function requireGatewayIdentity(options: { enforce?: boolean } = {}) {
  const enforce = options.enforce ?? process.env.NODE_ENV !== 'test';
  return (req: Req, res: Res, next: () => void): void => {
    if (!enforce || !hasIdentity(req.headers)) return next();
    if (verifyIdentity(req.headers)) return next();
    res.status(401).json({ error: 'Untrusted identity: requests must come through the gateway' });
  };
}
