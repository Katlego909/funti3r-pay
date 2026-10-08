import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { v4 as uuid } from 'uuid';
import { createLogger, assertInternalAuthConfigured, assertJwtConfigured, stripIdentity, requestContext, createMetrics } from '@funti3r/shared-utils';
import { initPostgres, initRedis, getRedis } from '@funti3r/database';
import { authMiddleware } from './middleware/auth.js';

const logger = createLogger('APIGateway');
const app = express();
// Behind Caddy and the dashboard's nginx there are two proxy hops; trusting exactly that many makes req.ip the
// real client (and rate limits per client, not one shared bucket). 0 when the gateway is reached directly (dev).
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 0));
const PORT = parseInt(process.env.API_PORT || '3000', 10);

const USER_SERVICE    = process.env.USER_SERVICE_URL    || 'http://localhost:3001';
const PAYMENT_SERVICE = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3002';
const COMPLIANCE_URL  = process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:3003';
const ANALYTICS_URL   = process.env.ANALYTICS_SERVICE_URL  || 'http://localhost:3004';

// Single source of truth for which frontend origins may talk to this gateway —
// used both for CORS and for the returnTo redirect allowlist below, so the
// two controls can't drift out of sync with each other.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS?.split(',') ?? [
  'http://localhost:3100',
  'http://localhost:3102',
]).map((o) => o.trim());

// ── Security & basics ─────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}));

// Every request gets an id that follows it through every service and into every log line. A client may supply one
// (to correlate with its own logs) but only in a plain, bounded form; anything else is replaced, so a caller cannot
// inject arbitrary text into our logs through this header.
const metrics = createMetrics('api-gateway');
const PLAIN_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
app.use((req, _res, next) => {
  const supplied = req.headers['x-request-id'];
  req.headers['x-request-id'] = typeof supplied === 'string' && PLAIN_REQUEST_ID.test(supplied) ? supplied : uuid();
  next();
});
// Access log + request metrics for every request, including ones the auth or rate limits turn away.
app.use(requestContext('APIGateway', metrics.observeRequest));

// ── Rate limiting ─────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please wait' },
});

if (process.env.NODE_ENV !== 'development') {
  app.use(globalLimiter);
  app.use('/auth', authLimiter);
}

/**
 * Money-moving and identity-submitting writes get a tight per-user limit (per IP before login), kept in Redis so it
 * holds across gateway instances. It runs in every environment: a stuck client or a stolen session cannot hammer
 * payouts, cash-outs or KYC. Reads are not limited here.
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const moneyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests for this action, please slow down' },
  skip: (req) => !WRITE_METHODS.has(req.method),
  keyGenerator: (req) => {
    const user = req.headers['x-user-id'];
    return typeof user === 'string' && user ? `user:${user}` : `ip:${req.ip ?? 'unknown'}`;
  },
  // Count in Redis; if Redis is down, serve the request rather than turn a cache outage into a payments outage.
  passOnStoreError: true,
  store: new RedisStore({
    prefix: 'rl:money:',
    sendCommand: async (...args: string[]) => (await getRedis()).sendCommand(args),
  }),
});

// A client never gets to say who it is: drop any identity headers it sent (public routes included),
// then the auth middleware sets and signs the real ones from the verified token.
assertInternalAuthConfigured();
assertJwtConfigured();
app.use((req, _res, next) => {
  stripIdentity(req.headers);
  next();
});

// ── Auth middleware ───────────────────────────────────────────────────────────

app.use(authMiddleware);
// After auth, so the limit is per signed-in user.
app.use(['/payouts', '/api/payouts', '/escrows', '/api/escrows', '/cashouts', '/api/cashouts', '/schedules', '/api/schedules',
  '/compliance', '/api/compliance', '/wallets', '/api/wallets'], moneyLimiter);


// ── Own endpoints ─────────────────────────────────────────────────────────────

app.get('/', (_, res) => {
  res.json({ name: 'Funti3r-Pay API Gateway', version: '0.1.0', docs: '/health' });
});

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', service: 'api-gateway', uptime: process.uptime() });
});

const ALLOWED_REDIRECT_ORIGINS = new Set(ALLOWED_ORIGINS);

app.get('/auth.html', (req, res) => {
  const requested = req.query.returnTo as string | undefined;
  // Validate returnTo is an explicitly allowed origin to prevent open-redirect / XSS.
  let returnTo = 'http://localhost:3100';
  if (requested) {
    try {
      const origin = new URL(requested).origin;
      if (ALLOWED_REDIRECT_ORIGINS.has(origin)) returnTo = requested;
      else logger.warn('auth.html: rejected disallowed returnTo', { returnTo: requested });
    } catch {
      logger.warn('auth.html: rejected malformed returnTo', { returnTo: requested });
    }
  }
  // JSON-encode so the value is safely embedded in a JS string literal.
  const safeReturnTo = JSON.stringify(returnTo);
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Funti3r-Pay Authentication</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
</head>
<body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
  <div style="text-align: center;">
    <h1>Authenticating...</h1>
    <p>Please wait while we set up your authentication.</p>
  </div>
  <script>
    var dest = ${safeReturnTo};
    sessionStorage.setItem('authReturnTo', dest);
    window.location.href = dest;
  </script>
</body>
</html>`);
});

app.get('/status', async (_, res) => {
  const checks = await Promise.allSettled([
    initPostgres(),
    initRedis(),
  ]);

  const [pg, redis] = checks.map((r) =>
    r.status === 'fulfilled' ? 'connected' : 'unavailable',
  );

  const healthy = checks.every((r) => r.status === 'fulfilled');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'operational' : 'degraded',
    services: { postgres: pg, redis },
    timestamp: new Date().toISOString(),
  });
});

// ── Proxy configuration ───────────────────────────────────────────────────────

function proxy(target: string, pathRewrite?: Record<string, string>) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite,
    timeout: 30000,
    on: {
      error: (err, _req, res) => {
        logger.error('Proxy error', { target, error: String(err) });
        if (!('headersSent' in res && res.headersSent)) {
          (res as express.Response).status(503).json({ error: 'Service temporarily unavailable' });
        }
      },
    },
  });
}

// Rebuild path for stripped auth routes
app.use((req, _res, next) => {
  if (req.path.match(/^\/(register|login|refresh|logout)\//)) {
    logger.debug('Rebuilding auth path', { from: req.url, to: '/auth' + req.url });
    req.url = '/auth' + req.url;
  }
  next();
});

// Auth & Users → user-service
app.all('/auth*', proxy(USER_SERVICE));
app.all('/api/auth*', proxy(USER_SERVICE, { '^/api/auth': '/auth' }));
app.all('/users*', proxy(USER_SERVICE));
app.all('/api/users*', proxy(USER_SERVICE, { '^/api/users': '/users' }));
app.all('/invites*', proxy(USER_SERVICE));
app.all('/api/invites*', proxy(USER_SERVICE, { '^/api/invites': '/invites' }));
app.all('/company*', proxy(USER_SERVICE));
app.all('/api/company*', proxy(USER_SERVICE, { '^/api/company': '/company' }));
app.all('/notifications*', proxy(USER_SERVICE));
app.all('/api/notifications*', proxy(USER_SERVICE, { '^/api/notifications': '/notifications' }));

// Wallets & Payouts → payment-service
app.all('/wallets*', proxy(PAYMENT_SERVICE));
app.all('/api/wallets*', proxy(PAYMENT_SERVICE, { '^/api/wallets': '/wallets' }));
app.all('/payouts*', proxy(PAYMENT_SERVICE));
app.all('/api/payouts*', proxy(PAYMENT_SERVICE, { '^/api/payouts': '/payouts' }));
app.all('/schedules*', proxy(PAYMENT_SERVICE));
app.all('/api/schedules*', proxy(PAYMENT_SERVICE, { '^/api/schedules': '/schedules' }));
app.all('/escrows*', proxy(PAYMENT_SERVICE));
app.all('/api/escrows*', proxy(PAYMENT_SERVICE, { '^/api/escrows': '/escrows' }));
app.all('/cashouts*', proxy(PAYMENT_SERVICE));
app.all('/api/cashouts*', proxy(PAYMENT_SERVICE, { '^/api/cashouts': '/cashouts' }));

// Compliance → compliance-service
app.all(['/compliance*', '/api/compliance*'], proxy(COMPLIANCE_URL, { '^/api/compliance': '', '^/compliance': '' }));

// Analytics → analytics-service
app.use('/analytics', proxy(ANALYTICS_URL));

// ── Error Handler ────────────────────────────────────────────────────────────

app.use((err: any, req: any, res: any, next: any) => {
  logger.error('Unhandled error', { error: String(err), path: req.path });
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  try {
    await initPostgres();
    logger.info('PostgreSQL connected');
  } catch { logger.warn('PostgreSQL unavailable at startup'); }

  try {
    await initRedis();
    logger.info('Redis connected');
  } catch { logger.warn('Redis unavailable at startup'); }

  // Metrics are served on their own port, reachable by the monitoring stack inside the network and never published
  // or proxied, so nothing on the public port exposes them.
  const metricsApp = express();
  metricsApp.get('/metrics', metrics.handler);
  metricsApp.listen(parseInt(process.env.METRICS_PORT || '9464', 10), '0.0.0.0');

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`API Gateway running on port ${PORT}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start', { error: String(err) });
  process.exit(1);
});
