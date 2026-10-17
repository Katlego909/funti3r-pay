import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'j'.repeat(40);

const { hasSessionFor } = await import('./sessionAuth.js');
const { generateToken } = await import('@funti3r/shared-utils');
const { UserRole } = await import('@funti3r/shared-types');

const req = (authorization?: string) => ({ headers: { authorization } }) as never;
const tokenFor = (userId: string) => generateToken(userId, `${userId}@x.io`, UserRole.WORKER);

test('a token issued to this user is a session for them', () => {
  assert.equal(hasSessionFor(req(`Bearer ${tokenFor('user-1')}`), 'user-1'), true);
});

test("someone else's token is not a session for this user (no account takeover)", () => {
  assert.equal(hasSessionFor(req(`Bearer ${tokenFor('user-2')}`), 'user-1'), false);
});

test('no header, a malformed header and a bad token are not sessions', () => {
  assert.equal(hasSessionFor(req(), 'user-1'), false);
  assert.equal(hasSessionFor(req('Basic abc'), 'user-1'), false);
  assert.equal(hasSessionFor(req('Bearer not-a-jwt'), 'user-1'), false);
});
