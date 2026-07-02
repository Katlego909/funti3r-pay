import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { v4 as uuid } from 'uuid';
import { createLogger } from '@funti3r/shared-utils';
import { initPostgres, initRedis, initMongoDB } from '@funti3r/database';
import { authMiddleware } from './middleware/auth.js';

const logger = createLogger('APIGateway');
const app = express();
const PORT = parseInt(process.env.API_PORT || '3000', 10);

const USER_SERVICE    = process.env.USER_SERVICE_URL    || 'http://localhost:3001';
const PAYMENT_SERVICE = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3002';
const COMPLIANCE_URL  = process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:3003';
const ANALYTICS_URL   = process.env.ANALYTICS_SERVICE_URL  || 'http://localhost:3004';

// ── Security & basics ─────────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [
    'http://localhost:3100',
    'http://localhost:3102',
  ],
  credentials: true,
}));

// Attach a unique request ID to every request for distributed tracing
app.use((req, _res, next) => {
  req.headers['x-request-id'] = req.headers['x-request-id'] ?? uuid();
  next();
});

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

// ── Auth middleware ───────────────────────────────────────────────────────────

app.use(authMiddleware);

// ── Request logging ───────────────────────────────────────────────────────────

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('Request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
      requestId: req.headers['x-request-id'],
    });
  });
  next();
});

// ── Own endpoints ─────────────────────────────────────────────────────────────

app.get('/', (_, res) => {
  res.json({ name: 'Funti3r-Pay API Gateway', version: '0.1.0', docs: '/health' });
});

app.get('/health', (_, res) => {
  res.json({ status: 'healthy', service: 'api-gateway', uptime: process.uptime() });
});

const ALLOWED_REDIRECT_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS?.split(',') ?? [
    'http://localhost:3100',
    'http://localhost:3102',
  ]).map((o) => o.trim()),
);

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
    initMongoDB(),
  ]);

  const [pg, redis, mongo] = checks.map((r) =>
    r.status === 'fulfilled' ? 'connected' : 'unavailable',
  );

  const healthy = checks.every((r) => r.status === 'fulfilled');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'operational' : 'degraded',
    services: { postgres: pg, redis, mongodb: mongo },
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

// Wallets & Payouts → payment-service
app.all('/wallets*', proxy(PAYMENT_SERVICE));
app.all('/api/wallets*', proxy(PAYMENT_SERVICE, { '^/api/wallets': '/wallets' }));
app.all('/payouts*', proxy(PAYMENT_SERVICE));
app.all('/api/payouts*', proxy(PAYMENT_SERVICE, { '^/api/payouts': '/payouts' }));
app.all('/schedules*', proxy(PAYMENT_SERVICE));
app.all('/api/schedules*', proxy(PAYMENT_SERVICE, { '^/api/schedules': '/schedules' }));

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

  try {
    await initMongoDB();
    logger.info('MongoDB connected');
  } catch { logger.warn('MongoDB unavailable at startup'); }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`API Gateway running on port ${PORT}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start', { error: String(err) });
  process.exit(1);
});
