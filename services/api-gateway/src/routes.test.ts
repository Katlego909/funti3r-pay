import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'j'.repeat(40);
process.env.INTERNAL_AUTH_SECRET = 'i'.repeat(40);

const { mountProxyRoutes } = await import('./routes.js');

interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }
type Name = 'user' | 'payment' | 'compliance' | 'analytics';

const seen: Record<Name, Seen[]> = { user: [], payment: [], compliance: [], analytics: [] };
const upstreamServers: http.Server[] = [];
const urls = {} as Record<Name, string>;
let gateway: http.Server;
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
  // The stripped auth routes are rebuilt under /auth before proxying.
  ['/login/start', 'user', '/auth/login/start'],
  ['/register/finish', 'user', '/auth/register/finish'],
  ['/refresh/x', 'user', '/auth/refresh/x'],
  ['/logout/x', 'user', '/auth/logout/x'],
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
