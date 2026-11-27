import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'j'.repeat(40);
process.env.INTERNAL_AUTH_SECRET = 'i'.repeat(40);

const { mountProxyRoutes, stripApiPrefix } = await import('./routes.js');

interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }
type Name = 'user' | 'payment' | 'compliance' | 'analytics';

const seen: Record<Name, Seen[]> = { user: [], payment: [], compliance: [], analytics: [] };
const upstreamServers: http.Server[] = [];
const urls = {} as Record<Name, string>;
let gateway: http.Server;
let authLimited = 0;
let gatewayUrl: string;

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

before(async () => {
  for (const name of Object.keys(seen) as Name[]) {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen[name].push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ upstream: name }));
      });
    });
    upstreamServers.push(server);
    urls[name] = await listen(server);
  }

  const app = express();
  app.use(stripApiPrefix);
  // Stand-in for the gateway's authLimiter, mounted on /auth only: it must also see the dashboard's /api/auth calls.
  app.use('/auth', (_req, _res, next) => { authLimited++; next(); });
  // Stand-in for stripIdentity + authMiddleware: the identity the real middleware would have set from a verified token.
  app.use((req, _res, next) => {
    req.headers['x-user-id'] = 'user-1';
    req.headers['x-user-role'] = req.headers['x-test-role'] ?? 'worker';
    req.headers['x-company-id'] = 'co-1';
    next();
  });
  mountProxyRoutes(app, urls);
  gateway = http.createServer(app);
  gatewayUrl = await listen(gateway);
});

after(async () => {
  for (const server of [gateway, ...upstreamServers]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function call(path: string, init: RequestInit = {}) {
  for (const list of Object.values(seen)) list.length = 0;
  const res = await fetch(gatewayUrl + path, init);
  const text = await res.text();
  const reached = (Object.keys(seen) as Name[]).filter((n) => seen[n].length > 0);
  return { status: res.status, text, reached, seen };
}

// [public path, upstream, path the upstream must see]
const ROUTES: [string, Name, string][] = [
  ['/auth/login/start', 'user', '/auth/login/start'],
  ['/api/auth/login/start', 'user', '/auth/login/start'],
  ['/users/abc?x=1', 'user', '/users/abc?x=1'],
  ['/api/users/abc?x=1', 'user', '/users/abc?x=1'],
  ['/invites/tok', 'user', '/invites/tok'],
  ['/api/invites/tok', 'user', '/invites/tok'],
  ['/company/members', 'user', '/company/members'],
  ['/api/company/members', 'user', '/company/members'],
  ['/notifications', 'user', '/notifications'],
  ['/api/notifications', 'user', '/notifications'],
  ['/wallets/me', 'payment', '/wallets/me'],
  ['/api/wallets/me', 'payment', '/wallets/me'],
  ['/payouts', 'payment', '/payouts'],
  ['/api/payouts', 'payment', '/payouts'],
  ['/schedules/1', 'payment', '/schedules/1'],
  ['/api/schedules/1', 'payment', '/schedules/1'],
  ['/escrows', 'payment', '/escrows'],
  ['/api/escrows', 'payment', '/escrows'],
  ['/cashouts', 'payment', '/cashouts'],
  ['/api/cashouts', 'payment', '/cashouts'],
  ['/compliance/kyc/status', 'compliance', '/kyc/status'],
  ['/api/compliance/kyc/status', 'compliance', '/kyc/status'],
];

for (const [path, upstream, expected] of ROUTES) {
  test(`${path} reaches ${upstream}-service as ${expected}, with the gateway identity headers`, async () => {
    const r = await call(path);
    assert.equal(r.status, 200);
    assert.deepEqual(r.reached, [upstream]);
    const hit = r.seen[upstream][0];
    assert.equal(hit.url, expected);
    // The regression the whole app hinges on: x-user-* must survive proxying.
    assert.equal(hit.headers['x-user-id'], 'user-1');
    assert.equal(hit.headers['x-user-role'], 'worker');
    assert.equal(hit.headers['x-company-id'], 'co-1');
  });
}

test('method and body are forwarded', async () => {
  const r = await call('/api/payouts', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: 5 }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.seen.payment[0].method, 'POST');
  assert.equal(r.seen.payment[0].body, '{"amount":5}');
  assert.equal(r.seen.payment[0].headers['x-user-id'], 'user-1');
});

test('compliance /screen is never reachable from a browser', async () => {
  for (const path of ['/compliance/screen', '/api/compliance/screen']) {
    const r = await call(path, { method: 'POST' });
    assert.equal(r.status, 404, path);
    assert.deepEqual(r.reached, [], path);
  }
});

test('analytics is for admins only', async () => {
  const worker = await call('/analytics/events');
  assert.ok(worker.status === 401 || worker.status === 403, `got ${worker.status}`);
  assert.deepEqual(worker.reached, []);

  const admin = await call('/analytics/events', { headers: { 'x-test-role': 'admin' } });
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.reached, ['analytics']);
  assert.equal(admin.seen.analytics[0].headers['x-user-id'], 'user-1');
});

test('an unknown path reaches no service', async () => {
  const r = await call('/nope');
  assert.equal(r.status, 404);
  assert.deepEqual(r.reached, []);
});

test('an upstream that is down gives 503, not a hang or a crash', async () => {
  const app = express();
  mountProxyRoutes(app, { ...urls, payment: 'http://127.0.0.1:1' });
  const server = http.createServer(app);
  const url = await listen(server);
  const res = await fetch(`${url}/payouts`);
  assert.equal(res.status, 503);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('the /auth rate limit also covers the /api/auth calls the dashboard makes', async () => {
  const before = authLimited;
  await call('/api/auth/login/start', { method: 'POST' });
  assert.equal(authLimited, before + 1);
});

// [admin path, service, path the service sees]
const ADMIN_ROUTES: [string, Name, string][] = [
  ['/admin/search?q=ada', 'user', '/admin/search?q=ada'],
  ['/admin/users/u1', 'user', '/admin/users/u1'],
  ['/admin/companies/c1', 'user', '/admin/companies/c1'],
  ['/admin/money/u1', 'payment', '/admin/money/u1'],
  ['/admin/payments?status=failed', 'payment', '/admin/payments?status=failed'],
  ['/admin/escrows', 'payment', '/admin/escrows'],
  ['/admin/cashouts', 'payment', '/admin/cashouts'],
  ['/admin/ops', 'payment', '/admin/ops'],
  ['/admin/audit', 'payment', '/admin/audit'],
  ['/admin/batches', 'payment', '/admin/batches'],
  ['/admin/schedules?status=paused', 'payment', '/admin/schedules?status=paused'],
  ['/admin/users?role=worker', 'user', '/admin/users?role=worker'],
  ['/admin/companies', 'user', '/admin/companies'],
  ['/admin/compliance/queue?status=pending', 'compliance', '/queue?status=pending'],
  ['/api/admin/ops', 'payment', '/admin/ops'], // the dashboard-style /api prefix is stripped first
  ['/admin/compliance/flagged', 'compliance', '/flagged'], // the compliance service's own routes
];

for (const [path, upstream, expected] of ADMIN_ROUTES) {
  test(`admin ${path} reaches ${upstream}-service as ${expected}`, async () => {
    const r = await call(path, { headers: { 'x-test-role': 'admin' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.reached, [upstream]);
    assert.equal(r.seen[upstream][0].url, expected);
  });
}

test('the admin console is refused to anyone but a platform admin, before reaching any service', async () => {
  for (const role of ['worker', 'enterprise']) {
    for (const path of ['/admin/users/u1', '/admin/users', '/admin/batches', '/admin/ops', '/admin/compliance/flagged', '/admin/compliance/queue']) {
      const r = await call(path, { headers: { 'x-test-role': role } });
      assert.equal(r.status, 403, `${role} ${path}`);
      assert.deepEqual(r.reached, [], `${role} ${path}`);
    }
  }
});

test('the internal sanctions screen stays unreachable through the admin console too', async () => {
  const r = await call('/admin/compliance/screen', { method: 'POST', headers: { 'x-test-role': 'admin' } });
  assert.equal(r.status, 404);
  assert.deepEqual(r.reached, []);
});

test('the admin console sees the readiness of every service; one that is down shows as unreachable', async () => {
  const app = express();
  app.use((req, _res, next) => { req.headers['x-user-role'] = req.headers['x-test-role'] ?? 'worker'; next(); });
  mountProxyRoutes(app, { ...urls, analytics: 'http://127.0.0.1:1' });
  const server = http.createServer(app);
  const url = await listen(server);
  try {
    assert.equal((await fetch(`${url}/admin/health`)).status, 403);
    for (const name of ['user', 'payment', 'compliance'] as const) seen[name].length = 0;
    const res = await fetch(`${url}/admin/health`, { headers: { 'x-test-role': 'admin' } });
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, any>;
    for (const name of ['user', 'payment', 'compliance'] as const) {
      assert.deepEqual(body[name], { httpStatus: 200, upstream: name });
      assert.equal(seen[name][0].url, '/health/ready');
    }
    assert.equal(body.analytics.status, 'unreachable');
  } finally {
    server.close();
  }
});

