import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createLogger } from '@funti3r/shared-utils';
import { requireRole } from './middleware/requireRole.js';

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
 * Routing uses app.all() + a proxyReq-style http-proxy-middleware so the x-user-* headers set by the auth
 * middleware survive proxying — a plain app.use proxy silently drops them (see CLAUDE.md).
 */
export function mountProxyRoutes(app: express.Express, upstreams: Upstreams): void {
  // Rebuild path for stripped auth routes
  app.use((req, _res, next) => {
    if (req.path.match(/^\/(register|login|refresh|logout)\//)) {
      logger.debug('Rebuilding auth path', { from: req.url, to: '/auth' + req.url });
      req.url = '/auth' + req.url;
    }
    next();
  });

  // Auth & Users → user-service
  app.all('/auth*', proxy(upstreams.user));
  app.all('/api/auth*', proxy(upstreams.user, { '^/api/auth': '/auth' }));
  app.all('/users*', proxy(upstreams.user));
  app.all('/api/users*', proxy(upstreams.user, { '^/api/users': '/users' }));
  app.all('/invites*', proxy(upstreams.user));
  app.all('/api/invites*', proxy(upstreams.user, { '^/api/invites': '/invites' }));
  app.all('/company*', proxy(upstreams.user));
  app.all('/api/company*', proxy(upstreams.user, { '^/api/company': '/company' }));
  app.all('/notifications*', proxy(upstreams.user));
  app.all('/api/notifications*', proxy(upstreams.user, { '^/api/notifications': '/notifications' }));

  // Wallets & Payouts → payment-service
  app.all('/wallets*', proxy(upstreams.payment));
  app.all('/api/wallets*', proxy(upstreams.payment, { '^/api/wallets': '/wallets' }));
  app.all('/payouts*', proxy(upstreams.payment));
  app.all('/api/payouts*', proxy(upstreams.payment, { '^/api/payouts': '/payouts' }));
  app.all('/schedules*', proxy(upstreams.payment));
  app.all('/api/schedules*', proxy(upstreams.payment, { '^/api/schedules': '/schedules' }));
  app.all('/escrows*', proxy(upstreams.payment));
  app.all('/api/escrows*', proxy(upstreams.payment, { '^/api/escrows': '/escrows' }));
  app.all('/cashouts*', proxy(upstreams.payment));
  app.all('/api/cashouts*', proxy(upstreams.payment, { '^/api/cashouts': '/cashouts' }));

  // Compliance → compliance-service
  // /screen is for the payment service (screening the employer behind an escrow), not for browsers: left reachable it
  // would let any signed-in user test arbitrary names against the sanctions list.
  app.all(['/compliance/screen', '/api/compliance/screen'], (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.all(['/compliance*', '/api/compliance*'], proxy(upstreams.compliance, { '^/api/compliance': '', '^/compliance': '' }));

  // Analytics → analytics-service
  // Event data spans every company and nothing in the product reads it yet, so it is for platform admins only.
  app.use('/analytics', requireRole('admin'), proxy(upstreams.analytics));
}
