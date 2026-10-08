import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasIdentity, requireGatewayIdentity, stampIdentity, stripIdentity, verifyIdentity } from './internalAuth.js';

const SECRET = 'a'.repeat(40);
process.env.INTERNAL_AUTH_SECRET = SECRET;

const identity = () => ({
  'x-user-id': 'u1', 'x-user-role': 'worker', 'x-user-email': 'w@x.io', 'x-company-id': 'c1',
}) as Record<string, string | undefined>;

test('a stamped identity verifies', () => {
  const h = identity();
  stampIdentity(h, 1_000_000);
  assert.equal(verifyIdentity(h, 1_000_000), true);
  assert.equal(verifyIdentity(h, 1_000_000 + 59_000), true);
});

test('changing any identity header breaks the signature (no privilege escalation)', () => {
  for (const [header, value] of [['x-user-role', 'admin'], ['x-user-id', 'u2'], ['x-company-id', 'c2'], ['x-user-email', 'a@x.io']]) {
    const h = identity();
    stampIdentity(h, 1_000_000);
    h[header] = value;
    assert.equal(verifyIdentity(h, 1_000_000), false, header);
  }
});

test('an old signature is refused (replay), and so is a missing or malformed one', () => {
  const h = identity();
  stampIdentity(h, 1_000_000);
  assert.equal(verifyIdentity(h, 1_000_000 + 61_000), false);
  assert.equal(verifyIdentity(identity(), 1_000_000), false);
  assert.equal(verifyIdentity({ ...identity(), 'x-gateway-ts': '1000000', 'x-gateway-sig': 'zz' }, 1_000_000), false);
});

test('a signature made with another secret is refused', () => {
  const h = identity();
  stampIdentity(h, 1_000_000, 'b'.repeat(40));
  assert.equal(verifyIdentity(h, 1_000_000), false);
});

test('stripIdentity removes everything a client could have forged', () => {
  const h = { ...identity(), 'x-gateway-ts': '1', 'x-gateway-sig': 'abc', authorization: 'Bearer t' } as Record<string, string | undefined>;
  stripIdentity(h);
  assert.equal(hasIdentity(h), false);
  assert.equal(h['x-gateway-sig'], undefined);
  assert.equal(h.authorization, 'Bearer t');
});

function run(headers: Record<string, string | undefined>, enforce = true) {
  let status: number | undefined;
  let passed = false;
  requireGatewayIdentity({ enforce })(
    { headers },
    { status: (code) => { status = code; return { json: () => undefined }; } },
    () => { passed = true; },
  );
  return { status, passed };
}

test('middleware: forged identity is rejected, stamped identity and anonymous requests pass', () => {
  assert.deepEqual(run(identity()), { status: 401, passed: false });

  const stamped = identity();
  stampIdentity(stamped);
  assert.deepEqual(run(stamped), { status: undefined, passed: true });

  assert.deepEqual(run({}), { status: undefined, passed: true });
});

test('middleware: not enforced when switched off (unit tests of routes)', () => {
  assert.deepEqual(run(identity(), false), { status: undefined, passed: true });
});
