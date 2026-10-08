import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentKeyId, decryptFromString, encryptToString, encryptionKeyIdOf, isCurrentKeyEncrypted, isEncryptedString,
} from './encryption.js';

const K1 = '11'.repeat(32);
const K2 = '22'.repeat(32);

beforeEach(() => {
  process.env.MASTER_ENCRYPTION_KEY = K1;
  process.env.MASTER_ENCRYPTION_KEY_ID = 'k1';
  delete process.env.MASTER_ENCRYPTION_KEYS_OLD;
});

test('values are written with the current key id and read back', () => {
  const stored = encryptToString('SSECRET');
  assert.ok(stored.startsWith('enc:v2:k1:'));
  assert.equal(encryptionKeyIdOf(stored), 'k1');
  assert.ok(isCurrentKeyEncrypted(stored));
  assert.equal(decryptFromString(stored), 'SSECRET');
});

test('after a rotation, old values still decrypt with the retired key and new ones use the new key', () => {
  const before = encryptToString('SSECRET');

  process.env.MASTER_ENCRYPTION_KEY = K2;
  process.env.MASTER_ENCRYPTION_KEY_ID = 'k2';
  process.env.MASTER_ENCRYPTION_KEYS_OLD = `k1:${K1}`;

  assert.equal(currentKeyId(), 'k2');
  assert.equal(decryptFromString(before), 'SSECRET');
  assert.equal(isCurrentKeyEncrypted(before), false, 'flagged for re-encryption');
  const after = encryptToString(decryptFromString(before));
  assert.ok(isCurrentKeyEncrypted(after));
  assert.equal(decryptFromString(after), 'SSECRET');
});

test('a retired key that is no longer configured makes its values undecryptable, loudly', () => {
  const before = encryptToString('SSECRET');
  process.env.MASTER_ENCRYPTION_KEY = K2;
  process.env.MASTER_ENCRYPTION_KEY_ID = 'k2';
  assert.throws(() => decryptFromString(before), /No encryption key "k1"/);
});

test('legacy v1 values (no key id) decrypt with the current key or any retired one', () => {
  const v1 = encryptToString('LEGACY', Buffer.from(K1, 'hex'));
  assert.ok(v1.startsWith('enc:v1:'));
  assert.equal(encryptionKeyIdOf(v1), null);
  assert.equal(decryptFromString(v1), 'LEGACY');

  process.env.MASTER_ENCRYPTION_KEY = K2;
  process.env.MASTER_ENCRYPTION_KEY_ID = 'k2';
  process.env.MASTER_ENCRYPTION_KEYS_OLD = `k1:${K1}`;
  assert.equal(decryptFromString(v1), 'LEGACY');
  assert.equal(isCurrentKeyEncrypted(v1), false);
});

test('plaintext passes through untouched, and tampering is detected', () => {
  assert.equal(isEncryptedString('plain'), false);
  assert.equal(decryptFromString('plain'), 'plain');
  const stored = encryptToString('SSECRET');
  const parts = stored.split(':');
  parts[parts.length - 1] = Buffer.from('tampered-bytes').toString('base64');
  assert.throws(() => decryptFromString(parts.join(':')));
});

test('a malformed retired-key list is rejected rather than ignored', () => {
  process.env.MASTER_ENCRYPTION_KEYS_OLD = 'nonsense';
  assert.throws(() => decryptFromString(encryptToString('x')), /MASTER_ENCRYPTION_KEYS_OLD/);
});
