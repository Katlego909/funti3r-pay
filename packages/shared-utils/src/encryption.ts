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
// Format: "enc:v1:<salt>:<iv>:<tag>:<ciphertext>" (each part base64; base64 has
// no ':' so it is a safe delimiter). decryptFromString tolerates legacy
// plaintext values (no "enc:" prefix) so a migration can run safely.

const ENC_PREFIX = 'enc:v1:';

export function isEncryptedString(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export function encryptToString(plaintext: string, masterKey?: Buffer): string {
  const e = encryptSecret(plaintext, masterKey);
  return `${ENC_PREFIX}${e.salt}:${e.iv}:${e.tag}:${e.ciphertext}`;
}

export function decryptFromString(value: string, masterKey?: Buffer): string {
  if (!isEncryptedString(value)) {
    // Legacy plaintext (pre-encryption) — return as-is.
    return value;
  }
  const body = value.slice(ENC_PREFIX.length);
  const [salt, iv, tag, ...rest] = body.split(':');
  const ciphertext = rest.join(':'); // defensive; ciphertext base64 has no ':'
  if (!salt || !iv || !tag || !ciphertext) {
    throw new Error('Malformed encrypted secret string');
  }
  return decryptSecret({ salt, iv, tag, ciphertext }, masterKey);
}
