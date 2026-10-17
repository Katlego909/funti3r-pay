import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decoyCredentialId } from './loginDecoy.js';

const SECRET = 's'.repeat(40);

test('the same email and origin always get the same decoy, so repeated probes match', () => {
  assert.equal(
    decoyCredentialId('a@x.io', 'https://pay.funti3r.xyz', SECRET),
    decoyCredentialId('a@x.io', 'https://pay.funti3r.xyz', SECRET),
  );
});

test('a different email, origin or server secret gives a different decoy', () => {
  const base = decoyCredentialId('a@x.io', 'https://pay.funti3r.xyz', SECRET);
  assert.notEqual(decoyCredentialId('b@x.io', 'https://pay.funti3r.xyz', SECRET), base);
  assert.notEqual(decoyCredentialId('a@x.io', 'http://localhost:3100', SECRET), base);
  assert.notEqual(decoyCredentialId('a@x.io', 'https://pay.funti3r.xyz', 't'.repeat(40)), base);
});

test('a decoy has the shape of a real credential id (32 bytes, base64url)', () => {
  const id = decoyCredentialId('a@x.io', 'https://pay.funti3r.xyz', SECRET);
  assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(id, 'base64url').length, 32);
});
