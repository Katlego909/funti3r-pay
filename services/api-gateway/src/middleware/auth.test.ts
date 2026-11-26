import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'j'.repeat(40);
process.env.INTERNAL_AUTH_SECRET = 'i'.repeat(40);

const { createAuthMiddleware } = await import('./auth.js');
const { generateToken, stripIdentity, verifyIdentity } = await import('@funti3r/shared-utils');
const { UserRole } = await import('@funti3r/shared-types');

type Headers = Record<string, string | string[] | undefined>;

const statuses: Record<string, string> = { 'user-1': 'active', 'user-s': 'suspended', 'user-c': 'closed' };
let statusReads = 0;
const authMiddleware = createAuthMiddleware(async (id) => {
  statusReads++;
  if (id === 'user-db-down') throw new Error('connection refused');
  return statuses[id] ?? null;
});

async function run(path: string, headers: Headers, method = 'GET') {
  let status: number | undefined;
  let body: any;
  let passed = false;
  const req = { path, method, headers } as never;
  const res = { status(code: number) { status = code; return { json: (b: unknown) => { body = b; } }; } } as never;
  await authMiddleware(req, res, () => { passed = true; });
  return { status, passed, body };
}
const bearer = (id: string) => ({ authorization: `Bearer ${generateToken(id, 'w@x.io', UserRole.WORKER)}` });

test('a valid token gets its identity set from the token and signed for the services', async () => {
  const headers: Headers = { authorization: `Bearer ${generateToken('user-1', 'w@x.io', UserRole.WORKER, 'co-1')}` };
  assert.deepEqual(await run('/payouts', headers), { status: undefined, passed: true, body: undefined });
  assert.equal(headers['x-user-id'], 'user-1');
  assert.equal(headers['x-user-role'], 'worker');
  assert.equal(headers['x-company-id'], 'co-1');
  assert.equal(verifyIdentity(headers), true);
});

test('identity a client sends is replaced, never believed', async () => {
  // The index strips client-supplied identity before auth runs; do the same here, then authenticate as a worker.
  const headers: Headers = {
    authorization: `Bearer ${generateToken('user-1', 'w@x.io', UserRole.WORKER)}`,
    'x-user-role': 'admin', 'x-user-id': 'someone-else', 'x-company-id': 'other-co',
    'x-gateway-ts': '1', 'x-gateway-sig': 'forged',
  };
  stripIdentity(headers);
  await run('/payouts', headers);
  assert.equal(headers['x-user-role'], 'worker');
  assert.equal(headers['x-user-id'], 'user-1');
  assert.equal(headers['x-company-id'], undefined);
  assert.equal(verifyIdentity(headers), true);
});

test('no token, a bad token and a malformed header are refused', async () => {
  assert.equal((await run('/payouts', {})).status, 401);
  assert.equal((await run('/payouts', { authorization: 'Bearer nope' })).status, 401);
  assert.equal((await run('/payouts', { authorization: 'Basic abc' })).status, 401);
});

test('public routes need no token, carry no identity, and never read an account status', async () => {
  statusReads = 0;
  const headers: Headers = {};
  assert.deepEqual(await run('/auth/login/start', headers, 'POST'), { status: undefined, passed: true, body: undefined });
  assert.equal(headers['x-user-id'], undefined);
  await run('/health', {});
  assert.equal(statusReads, 0);
});

test('a suspended or closed account is refused on every request, even with a token issued before', async () => {
  for (const path of ['/payouts', '/escrows', '/compliance/x', '/users/me']) {
    const r = await run(path, bearer('user-s'), 'POST');
    assert.equal(r.status, 403, path);
    assert.equal(r.passed, false);
    assert.equal(r.body.code, 'ACCOUNT_SUSPENDED');
  }
  assert.equal((await run('/payouts', bearer('user-c'))).body.code, 'ACCOUNT_CLOSED');
});

test('a deleted account is signed out; an unreadable status refuses the request instead of letting it through', async () => {
  assert.equal((await run('/payouts', bearer('user-gone'))).status, 401);
  const down = await run('/payouts', bearer('user-db-down'));
  assert.equal(down.status, 503);
  assert.equal(down.passed, false);
});
