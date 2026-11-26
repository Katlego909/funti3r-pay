import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireRole } from './requireRole.js';

function run(role: string | string[] | undefined) {
  let status: number | undefined;
  let passed = false;
  const req = { headers: { 'x-user-role': role } } as never;
  const res = { status(code: number) { status = code; return { json: () => undefined }; } } as never;
  requireRole('admin')(req, res, () => { passed = true; });
  return { status, passed };
}

test('an admin passes', () => {
  assert.deepEqual(run('admin'), { status: undefined, passed: true });
});

test('a worker or an enterprise user is turned away', () => {
  assert.deepEqual(run('worker'), { status: 403, passed: false });
  assert.deepEqual(run('enterprise'), { status: 403, passed: false });
});

test('no role, or a role sent as a list, is turned away', () => {
  assert.deepEqual(run(undefined), { status: 403, passed: false });
  assert.deepEqual(run(['admin', 'admin']), { status: 403, passed: false });
});
