import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler, NotFoundError, ValidationError, ExternalServiceError } from './errors.js';
import { runWithLogContext } from './logger.js';

function run(err: unknown, opts: { headersSent?: boolean } = {}) {
  const logged: { level: string; message: string; data: any }[] = [];
  const logger = {
    warn: (message: string, data?: unknown) => { logged.push({ level: 'warn', message, data }); },
    error: (message: string, data?: unknown) => { logged.push({ level: 'error', message, data }); },
  };
  let status = 0;
  let body: any;
  let forwarded: unknown;
  const res = {
    headersSent: opts.headersSent ?? false,
    status: (c: number) => { status = c; return { json: (b: unknown) => { body = b; } }; },
  };
  errorHandler(logger)(err, { method: 'POST', path: '/payouts' }, res, (e) => { forwarded = e; });
  return { status, body, logged, forwarded };
}

test('an AppError is sent with its own status, message and code', () => {
  const r = run(new NotFoundError('User'));
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'User not found', code: 'NOT_FOUND' });
  assert.equal(r.logged[0].level, 'warn');
});

test('ValidationError details are sent as issues', () => {
  const r = run(new ValidationError('Bad input', { amount: ['must be positive'] }));
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.issues, { amount: ['must be positive'] });
});

test('a 5xx AppError carries the request id and is logged as an error', () => {
  const r = runWithLogContext({ requestId: 'req-1' }, () => run(new ExternalServiceError('Stellar', 'The Stellar network rejected the transaction', 'op_underfunded')));
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: 'The Stellar network rejected the transaction', code: 'op_underfunded', requestId: 'req-1' });
  assert.equal(r.logged[0].level, 'error');
});

test('any other error becomes a generic 500 that leaks nothing', () => {
  const r = runWithLogContext({ requestId: 'req-2' }, () => run(new Error('relation "users" does not exist')));
  assert.equal(r.status, 500);
  assert.equal(r.body.requestId, 'req-2');
  assert.ok(!JSON.stringify(r.body).includes('relation'));
  assert.match(r.logged[0].data.error.stack, /relation "users"/);
});

test('malformed JSON and oversized bodies are client errors', () => {
  assert.equal(run(Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed' })).status, 400);
  assert.equal(run(Object.assign(new Error('too large'), { type: 'entity.too.large' })).status, 413);
});

test('once headers are sent, the error is handed back to Express', () => {
  const err = new Error('late');
  const r = run(err, { headersSent: true });
  assert.equal(r.forwarded, err);
  assert.equal(r.status, 0);
});
