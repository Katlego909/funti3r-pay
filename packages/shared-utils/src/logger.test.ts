import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLogger, redact, runWithLogContext } from './logger.js';
import { requestContext } from './requestContext.js';

let lines: string[] = [];
const original = { log: console.log, warn: console.warn, error: console.error };

beforeEach(() => {
  lines = [];
  console.log = (l: string) => { lines.push(l); };
  console.warn = (l: string) => { lines.push(l); };
  console.error = (l: string) => { lines.push(l); };
  process.env.LOG_FORMAT = 'json';
});
afterEach(() => {
  Object.assign(console, original);
  delete process.env.LOG_FORMAT;
});

test('a log line is JSON with level, service, message and data', () => {
  createLogger('PaymentService').info('Payment settled', { paymentId: 'p1', amount: 5 });
  const line = JSON.parse(lines[0]);
  assert.equal(line.level, 'info');
  assert.equal(line.service, 'PaymentService');
  assert.equal(line.msg, 'Payment settled');
  assert.deepEqual(line.data, { paymentId: 'p1', amount: 5 });
  assert.ok(Date.parse(line.ts));
});

test('anything that names a credential or a personal identifier is redacted, at any depth', () => {
  createLogger('X').info('submitted', {
    userId: 'u1',
    secretKey: 'SABC',
    refresh_token: 'tok',
    nested: { password: 'pw', identity: { idNumber: '800101', fullName: 'A B' }, bankAccount: { accountNumber: '123' } },
    list: [{ apiKey: 'k', ok: 1 }],
    txHash: 'visible',
  });
  const data = JSON.parse(lines[0]).data;
  assert.equal(data.userId, 'u1');
  assert.equal(data.txHash, 'visible');
  assert.equal(data.secretKey, '[redacted]');
  assert.equal(data.refresh_token, '[redacted]');
  assert.equal(data.nested.password, '[redacted]');
  assert.equal(data.nested.identity.idNumber, '[redacted]');
  assert.equal(data.nested.identity.fullName, 'A B');
  assert.equal(data.nested.bankAccount, '[redacted]');
  assert.equal(data.list[0].apiKey, '[redacted]');
  assert.equal(data.list[0].ok, 1);
  assert.ok(!lines[0].includes('SABC'));
});

test('redact never throws on odd values and cuts runaway depth', () => {
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => redact(cyclic));
  assert.deepEqual(redact(new Error('boom')), { name: 'Error', message: 'boom' });
  assert.equal(redact(null), null);
  assert.equal(redact('plain'), 'plain');
});

test('lines written while handling a request carry its request id and user', () => {
  runWithLogContext({ requestId: 'req-1', userId: 'user-1', role: 'worker' }, () => {
    createLogger('X').warn('something happened');
  });
  const line = JSON.parse(lines[0]);
  assert.equal(line.requestId, 'req-1');
  assert.equal(line.userId, 'user-1');
  assert.equal(line.role, 'worker');

  createLogger('X').info('outside any request');
  assert.equal(JSON.parse(lines[1]).requestId, undefined);
});

test('requestContext reuses the gateway request id, echoes it, and logs one access line with the route pattern', () => {
  const headers: Record<string, string> = {};
  const res = Object.assign(new EventEmitter(), {
    statusCode: 201,
    setHeader: (k: string, v: string) => { headers[k] = v; },
  });
  const seen: unknown[] = [];
  const mw = requestContext('PaymentService', (info) => seen.push(info));
  const req = { method: 'POST', path: '/payouts/123', route: { path: '/payouts/:id' }, headers: { 'x-request-id': 'abc-123', 'x-user-id': 'u9', 'x-user-role': 'enterprise' } };
  mw(req as never, res as never, () => {
    createLogger('PaymentService').info('inside handler');
  });
  res.emit('finish');

  assert.equal(headers['x-request-id'], 'abc-123');
  const inside = JSON.parse(lines[0]);
  assert.equal(inside.requestId, 'abc-123');
  assert.equal(inside.userId, 'u9');
  const access = JSON.parse(lines[1]);
  assert.equal(access.msg, 'request');
  assert.deepEqual({ ...access.data, ms: 0 }, { method: 'POST', route: '/payouts/:id', status: 201, ms: 0 });
  assert.equal((seen[0] as { route: string }).route, '/payouts/:id');
});

test('probes are not access-logged, and a request without an id gets one', () => {
  const headers: Record<string, string> = {};
  const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: (k: string, v: string) => { headers[k] = v; } });
  requestContext('X')({ method: 'GET', path: '/health', headers: {} } as never, res as never, () => {});
  res.emit('finish');
  assert.equal(lines.length, 0);
  assert.match(headers['x-request-id'], /^[0-9a-f-]{36}$/);
});
