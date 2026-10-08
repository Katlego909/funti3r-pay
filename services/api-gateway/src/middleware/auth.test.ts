import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'j'.repeat(40);
process.env.INTERNAL_AUTH_SECRET = 'i'.repeat(40);

const { authMiddleware } = await import('./auth.js');
const { generateToken, stripIdentity, verifyIdentity } = await import('@funti3r/shared-utils');
const { UserRole } = await import('@funti3r/shared-types');

type Headers = Record<string, string | string[] | undefined>;

function run(path: string, headers: Headers, method = 'GET') {
  let status: number | undefined;
  let passed = false;
  const req = { path, method, headers } as never;
  const res = { status(code: number) { status = code; return { json: () => undefined }; } } as never;
  authMiddleware(req, res, () => { passed = true; });
  return { status, passed };
}

test('a valid token gets its identity set from the token and signed for the services', () => {
  const headers: Headers = { authorization: `Bearer ${generateToken('user-1', 'w@x.io', UserRole.WORKER, 'co-1')}` };
  assert.deepEqual(run('/payouts', headers), { status: undefined, passed: true });
  assert.equal(headers['x-user-id'], 'user-1');
  assert.equal(headers['x-user-role'], 'worker');
  assert.equal(headers['x-company-id'], 'co-1');
  assert.equal(verifyIdentity(headers), true);
});

test('identity a client sends is replaced, never believed', () => {
  // The index strips client-supplied identity before auth runs; do the same here, then authenticate as a worker.
  const headers: Headers = {
    authorization: `Bearer ${generateToken('user-1', 'w@x.io', UserRole.WORKER)}`,
    'x-user-role': 'admin', 'x-user-id': 'someone-else', 'x-company-id': 'other-co',
    'x-gateway-ts': '1', 'x-gateway-sig': 'forged',
  };
  stripIdentity(headers);
  run('/payouts', headers);
  assert.equal(headers['x-user-role'], 'worker');
  assert.equal(headers['x-user-id'], 'user-1');
  assert.equal(headers['x-company-id'], undefined);
  assert.equal(verifyIdentity(headers), true);
});

test('no token, a bad token and a malformed header are refused', () => {
  assert.equal(run('/payouts', {}).status, 401);
  assert.equal(run('/payouts', { authorization: 'Bearer nope' }).status, 401);
  assert.equal(run('/payouts', { authorization: 'Basic abc' }).status, 401);
});

test('public routes need no token and carry no identity', () => {
  const headers: Headers = {};
  assert.deepEqual(run('/auth/login/start', headers, 'POST'), { status: undefined, passed: true });
  assert.equal(headers['x-user-id'], undefined);
});
