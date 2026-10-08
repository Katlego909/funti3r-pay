import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHealth } from './health.js';
import { createMetrics } from './metrics.js';

type Handler = (req: unknown, res: { status(code: number): { json(body: unknown): unknown } }) => unknown;

function appWith(checks: Parameters<typeof registerHealth>[2]) {
  const routes = new Map<string, Handler>();
  registerHealth({ get: (path, handler) => { routes.set(path, handler as Handler); } }, 'svc', checks);
  return async (path: string) => {
    let status = 0;
    let body: any;
    await routes.get(path)!({}, { status: (c) => { status = c; return { json: (b) => { body = b; } }; } });
    return { status, body };
  };
}

test('liveness answers without touching any dependency', async () => {
  const get = appWith({ db: { critical: true, run: async () => { throw new Error('down'); } } });
  assert.equal((await get('/health')).status, 200);
  assert.equal((await get('/health/live')).body.service, 'svc');
});

test('readiness is 503 when a critical dependency fails, and says which', async () => {
  const get = appWith({
    db: { critical: true, run: async () => { throw new Error('connection refused'); } },
    cache: { critical: true, run: async () => {} },
  });
  const r = await get('/health/ready');
  assert.equal(r.status, 503);
  assert.equal(r.body.checks.db.ok, false);
  assert.equal(r.body.checks.db.error, 'connection refused');
  assert.equal(r.body.checks.cache.ok, true);
});

test('a failing non-critical dependency is reported but the instance stays ready', async () => {
  const get = appWith({
    db: { critical: true, run: async () => {} },
    horizon: { critical: false, run: async () => { throw new Error('502'); } },
  });
  const r = await get('/health/ready');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ready');
  assert.equal(r.body.checks.horizon.ok, false);
});

test('metrics: requests and custom counters appear in the Prometheus output, labelled by service', async () => {
  const m = createMetrics('payment-service');
  m.observeRequest({ method: 'POST', route: '/payouts', status: 201, seconds: 0.2 });
  m.counter('payouts_total', 'Payouts by outcome', ['status']).inc({ status: 'completed' });

  let out = '';
  await m.handler({}, { setHeader: () => {}, end: (b: string) => { out = b; }, status: () => ({ end: () => {} }) });
  assert.match(out, /http_request_duration_seconds_count\{(?=[^}]*service="payment-service")(?=[^}]*method="POST")(?=[^}]*route="\/payouts")(?=[^}]*status="201")[^}]*\} 1/);
  assert.match(out, /payouts_total\{(?=[^}]*service="payment-service")(?=[^}]*status="completed")[^}]*\} 1/);
  assert.match(out, /process_cpu_user_seconds_total/);
});
