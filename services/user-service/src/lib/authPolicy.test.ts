import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, rpOrigins, selfRegisterRole, signInRefusal } from './authPolicy.js';

test('nobody can register as a platform admin', () => {
  assert.equal(selfRegisterRole('admin'), null);
  assert.equal(selfRegisterRole('ADMIN'), null);
  assert.equal(selfRegisterRole('superuser'), null);
  assert.equal(selfRegisterRole(['admin']), null);
});

test('enterprise and worker can be chosen; no role means worker', () => {
  assert.equal(selfRegisterRole('enterprise'), 'enterprise');
  assert.equal(selfRegisterRole('worker'), 'worker');
  assert.equal(selfRegisterRole(undefined), 'worker');
});

test('passkey origins come from RP_ORIGINS, else the dashboard plus the local admin console', () => {
  assert.deepEqual(rpOrigins({ RP_ORIGINS: 'https://pay.funti3r.xyz, https://admin.funti3r.xyz' }),
    ['https://pay.funti3r.xyz', 'https://admin.funti3r.xyz']);
  assert.deepEqual(rpOrigins({ RP_ORIGIN: 'http://localhost:3100' }), ['http://localhost:3100', 'http://localhost:3200']);
});

test('a passkey request is only accepted from one of our origins', () => {
  const origins = ['https://pay.funti3r.xyz', 'https://admin.funti3r.xyz'];
  assert.equal(allowedOrigin('https://admin.funti3r.xyz', origins), 'https://admin.funti3r.xyz');
  assert.equal(allowedOrigin('https://evil.example', origins), null);
  assert.equal(allowedOrigin(undefined, origins), 'https://pay.funti3r.xyz'); // none named: the default
});

test('suspended and closed accounts cannot sign in or refresh; active ones can', () => {
  assert.match(signInRefusal('suspended') ?? '', /suspended/);
  assert.match(signInRefusal('closed') ?? '', /closed/);
  assert.equal(signInRefusal('active'), null);
});
