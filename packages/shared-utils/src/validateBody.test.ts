import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validateBody } from './validateBody.js';

const schema = z.object({ workerId: z.string().uuid(), memo: z.string().max(5).optional() });

function run(body: unknown) {
  const req = { body } as { body?: unknown };
  let status: number | undefined;
  let payload: any;
  let passed = false;
  validateBody(schema)(req, { status(code) { status = code; return { json: (b: unknown) => { payload = b; } }; } }, () => { passed = true; });
  return { req, status, payload, passed };
}

const ID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';

test('a valid body passes and is replaced by the parsed value, unknown keys dropped', () => {
  const r = run({ workerId: ID, extra: 'x' });
  assert.equal(r.passed, true);
  assert.deepEqual(r.req.body, { workerId: ID });
});

test('a bad id or an over-long string is a 400 naming the field, and nothing proceeds', () => {
  const bad = run({ workerId: 'not-a-uuid' });
  assert.equal(bad.status, 400);
  assert.equal(bad.passed, false);
  assert.match(bad.payload.error, /workerId/);
  assert.equal(bad.payload.issues[0].path, 'workerId');

  assert.equal(run({ workerId: ID, memo: 'too long' }).status, 400);
});

test('a missing body is validated as empty, not crashed on', () => {
  assert.equal(run(undefined).status, 400);
});
