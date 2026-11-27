import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createLogger, requireRole } from '@funti3r/shared-utils';

const logger = createLogger('APIGateway');

export interface Upstreams {
  user: string;
  payment: string;
  compliance: string;
  analytics: string;
}

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

/**
 * The dashboard calls everything under /api (its axios baseURL). The gateway drops that prefix once, ahead of the
 * rate limiters, the auth check and the proxies, so each of them knows every route by its one real path; a limit or
 * a public-path rule can then never be skipped by adding /api in front.
 */
export function stripApiPrefix(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  if (req.url === '/api' || req.url.startsWith('/api/') || req.url.startsWith('/api?')) req.url = req.url.slice(4) || '/';
  next();
}

/**
 * Routing uses app.all() + a proxyReq-style http-proxy-middleware so the x-user-* headers set by the auth
 * middleware survive proxying — a plain app.use proxy silently drops them. Mount after stripApiPrefix.
 */
const READINESS_TIMEOUT_MS = 5000;

/**
 * Every service's own readiness report (`/health/ready`, from registerHealth), side by side for the admin console. A
 * service that does not answer is shown as unreachable rather than failing the whole page.
 */
async function servicesReadiness(upstreams: Upstreams) {
  const entries = await Promise.all(Object.entries(upstreams).map(async ([name, url]) => {
    try {
      const res = await fetch(`${url}/health/ready`, { signal: AbortSignal.timeout(READINESS_TIMEOUT_MS) });
      return [name, { httpStatus: res.status, ...(await res.json() as object) }] as const;
    } catch (err) {
      return [name, { status: 'unreachable', error: err instanceof Error ? err.message : String(err) }] as const;
    }
  }));
  return Object.fromEntries(entries);
}

export function mountProxyRoutes(app: express.Express, upstreams: Upstreams): void {
  // Auth & Users → user-service
  app.all('/auth*', proxy(upstreams.user));
  app.all('/users*', proxy(upstreams.user));
  app.all('/invites*', proxy(upstreams.user));
  app.all('/company*', proxy(upstreams.user));
  app.all('/notifications*', proxy(upstreams.user));

  // Wallets & Payouts → payment-service
  app.all('/wallets*', proxy(upstreams.payment));
  app.all('/payouts*', proxy(upstreams.payment));
  app.all('/schedules*', proxy(upstreams.payment));
  app.all('/escrows*', proxy(upstreams.payment));
  app.all('/cashouts*', proxy(upstreams.payment));

  // Compliance → compliance-service
  // /screen is for the payment service (screening the employer behind an escrow), not for browsers: left reachable it
  // would let any signed-in user test arbitrary names against the sanctions list.
  app.all('/compliance/screen', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.all('/compliance*', proxy(upstreams.compliance, { '^/compliance': '' }));

  // Platform admin console → the service that owns each area. Admin-only here, and again in each service (defence in
  // depth: a service reached without the gateway still refuses). /admin/compliance strips its prefix, like /compliance,
  // so the compliance service's own routes (flagged queue, approve/reject, sanctions refresh, KYC detail) serve it.
  app.use('/admin', requireRole('admin'));
  app.get('/admin/health', async (_req, res) => { res.json(await servicesReadiness(upstreams)); });
  app.all(['/admin/search*', '/admin/users*', '/admin/companies*'], proxy(upstreams.user));
  app.all(['/admin/money*', '/admin/payments*', '/admin/escrows*', '/admin/cashouts*', '/admin/batches*', '/admin/schedules*',
    '/admin/ops*', '/admin/audit*'],
    proxy(upstreams.payment));
  app.all('/admin/compliance/screen', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.all('/admin/compliance*', proxy(upstreams.compliance, { '^/admin/compliance': '' }));

  // Analytics → analytics-service
  // Event data spans every company, so it is for platform admins only.
  app.use('/analytics', requireRole('admin'), proxy(upstreams.analytics));
}
