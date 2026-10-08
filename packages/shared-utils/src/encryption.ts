import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 16;
const PBKDF2_ITERATIONS = 100000;

function getMasterKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY;
  if (!hex) throw new Error('MASTER_ENCRYPTION_KEY environment variable is required');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error('MASTER_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
  }
  return key;
}

function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
  return pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256');
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  salt: string;
}

export function encryptSecret(plaintext: string, masterKey?: Buffer): EncryptedSecret {
  const key = masterKey || getMasterKey();
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = deriveKey(key, salt);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    salt: salt.toString('base64'),
  };
}

export function decryptSecret(encrypted: EncryptedSecret, masterKey?: Buffer): string {
  const key = masterKey || getMasterKey();
  const salt = Buffer.from(encrypted.salt, 'base64');
  const derivedKey = deriveKey(key, salt);
  const decipher = createDecipheriv(
    ALGORITHM,
    derivedKey,
    Buffer.from(encrypted.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// ── Single-column string format ───────────────────────────────────────────────
// Stores an EncryptedSecret as one string so it fits an existing TEXT column.
//   v2 (written now):  "enc:v2:<keyId>:<salt>:<iv>:<tag>:<ciphertext>"  names the key it was encrypted with
//   v1 (legacy):       "enc:v1:<salt>:<iv>:<tag>:<ciphertext>"           no key id; tried against every known key
// Each part is base64 (no ':'), so ':' is a safe delimiter. decryptFromString also tolerates plaintext (no "enc:"
// prefix) so a migration can run safely.
//
// Key rotation: MASTER_ENCRYPTION_KEY is the current key, named by MASTER_ENCRYPTION_KEY_ID (default "k1").
// Retired keys stay available for decrypting as MASTER_ENCRYPTION_KEYS_OLD="id:hex,id:hex" until every value has been
// re-encrypted (scripts/ops/rotate-keys.ts). Losing a key a value was written with makes that value unrecoverable.

const ENC_PREFIX_V1 = 'enc:v1:';
const ENC_PREFIX_V2 = 'enc:v2:';

function parseHexKey(hex: string, label: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_BYTES) throw new Error(`${label} must be exactly 32 bytes (64 hex characters)`);
  return key;
}

export function currentKeyId(): string {
  return process.env.MASTER_ENCRYPTION_KEY_ID || 'k1';
}

/** Every key this process may decrypt with, by id: the current one first, then the retired ones. */
function keyRing(): Map<string, Buffer> {
  const ring = new Map<string, Buffer>();
  ring.set(currentKeyId(), getMasterKey());
  for (const entry of (process.env.MASTER_ENCRYPTION_KEYS_OLD ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    const [id, hex] = entry.split(':');
    if (!id || !hex) throw new Error('MASTER_ENCRYPTION_KEYS_OLD must look like "id:hexkey,id:hexkey"');
    if (!ring.has(id)) ring.set(id, parseHexKey(hex, `MASTER_ENCRYPTION_KEYS_OLD key "${id}"`));
  }
  return ring;
}

/**
 * Decrypts the legacy split-column form (the wallets table stores ciphertext, iv, tag and salt separately, with no
 * key id) by trying each configured key; the authentication tag identifies the right one. Returns which key worked,
 * so a rotation can tell values still on a retired key.
 */
export function decryptWithRing(parts: EncryptedSecret): { plaintext: string; keyId: string } {
  let lastError: unknown;
  for (const [keyId, key] of keyRing()) {
    try {
      return { plaintext: decryptSecret(parts, key), keyId };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not decrypt with any configured key');
}

export function isEncryptedString(value: string | null | undefined): boolean {
  return typeof value === 'string' && (value.startsWith(ENC_PREFIX_V2) || value.startsWith(ENC_PREFIX_V1));
}

/** The id of the key a stored value was written with; null for legacy v1 values, which carry none. */
export function encryptionKeyIdOf(value: string): string | null {
  return value.startsWith(ENC_PREFIX_V2) ? (value.slice(ENC_PREFIX_V2.length).split(':')[0] ?? null) : null;
}

/** True when the value is already encrypted with the current key (so a rotation can skip it). */
export function isCurrentKeyEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX_V2) && encryptionKeyIdOf(value) === currentKeyId();
}

export function encryptToString(plaintext: string, masterKey?: Buffer): string {
  const e = encryptSecret(plaintext, masterKey);
  // An explicit key (tests, one-off tools) has no id in the ring, so it keeps the id-less v1 form.
  return masterKey
    ? `${ENC_PREFIX_V1}${e.salt}:${e.iv}:${e.tag}:${e.ciphertext}`
    : `${ENC_PREFIX_V2}${currentKeyId()}:${e.salt}:${e.iv}:${e.tag}:${e.ciphertext}`;
}

export function decryptFromString(value: string, masterKey?: Buffer): string {
  if (!isEncryptedString(value)) {
    // Legacy plaintext (pre-encryption): return as-is.
    return value;
  }

  if (value.startsWith(ENC_PREFIX_V2)) {
    const [keyId, salt, iv, tag, ...rest] = value.slice(ENC_PREFIX_V2.length).split(':');
    const ciphertext = rest.join(':');
    if (!keyId || !salt || !iv || !tag || !ciphertext) throw new Error('Malformed encrypted secret string');
    const key = masterKey ?? keyRing().get(keyId);
    if (!key) throw new Error(`No encryption key "${keyId}" is configured; this value cannot be decrypted`);
    return decryptSecret({ salt, iv, tag, ciphertext }, key);
  }

  const [salt, iv, tag, ...rest] = value.slice(ENC_PREFIX_V1.length).split(':');
  const ciphertext = rest.join(':'); // defensive; ciphertext base64 has no ':'
  if (!salt || !iv || !tag || !ciphertext) throw new Error('Malformed encrypted secret string');
  const parts = { salt, iv, tag, ciphertext };
  if (masterKey) return decryptSecret(parts, masterKey);
  // v1 values carry no key id: the authentication tag tells us which key was the right one.
  let lastError: unknown;
  for (const key of keyRing().values()) {
    try {
      return decryptSecret(parts, key);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not decrypt with any configured key');
}
