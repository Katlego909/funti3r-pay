import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertJwtConfigured } from './auth.js';

// A failed check caches nothing, so these can run in one process in this order: refusals first, then a good secret.
test('the placeholder secret from .env.example is refused outside the unit tests', () => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'change-this-to-a-long-random-secret-in-production';
  assert.throws(() => assertJwtConfigured(), /placeholder/);
});

test('a short secret is refused', () => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'too-short';
  assert.throws(() => assertJwtConfigured(), /at least 32/);
});

test('a missing secret is refused', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.JWT_SECRET;
  assert.throws(() => assertJwtConfigured(), /must be set/);
});

test('a real secret is accepted', () => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'f3a9c1d27b8e4a6f90d1c2b3a4958677e0d1c2b3a49586';
  assert.doesNotThrow(() => assertJwtConfigured());
});
