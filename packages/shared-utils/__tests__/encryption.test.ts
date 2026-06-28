import { encryptSecret, decryptSecret, type EncryptedSecret } from '../src/encryption';

describe('Encryption', () => {
  const testSecret = 'SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const masterKey = Buffer.from(process.env.MASTER_ENCRYPTION_KEY || '8374fbb1cfa5f80180097d8dba3d2e48a934d47cbd6237a59ceab127d0ca6019', 'hex');

  it('should encrypt and decrypt a secret', () => {
    const encrypted = encryptSecret(testSecret, masterKey);

    expect(encrypted).toHaveProperty('ciphertext');
    expect(encrypted).toHaveProperty('iv');
    expect(encrypted).toHaveProperty('tag');
    expect(encrypted).toHaveProperty('salt');

    const decrypted = decryptSecret(encrypted, masterKey);
    expect(decrypted).toBe(testSecret);
  });

  it('should produce different ciphertexts for same input (random IV/salt)', () => {
    const enc1 = encryptSecret(testSecret, masterKey);
    const enc2 = encryptSecret(testSecret, masterKey);

    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    expect(enc1.salt).not.toBe(enc2.salt);
    expect(enc1.iv).not.toBe(enc2.iv);

    expect(decryptSecret(enc1, masterKey)).toBe(testSecret);
    expect(decryptSecret(enc2, masterKey)).toBe(testSecret);
  });

  it('should reject tampered ciphertext', () => {
    const encrypted = encryptSecret(testSecret, masterKey);
    const tampered: EncryptedSecret = {
      ...encrypted,
      ciphertext: 'AAAAAAAAAA'
    };

    expect(() => decryptSecret(tampered, masterKey)).toThrow();
  });

  it('should reject tampered tag', () => {
    const encrypted = encryptSecret(testSecret, masterKey);
    const tampered: EncryptedSecret = {
      ...encrypted,
      tag: Buffer.alloc(16).toString('base64')
    };

    expect(() => decryptSecret(tampered, masterKey)).toThrow();
  });

  it('should encrypt different secrets differently', () => {
    const secret1 = 'secret1';
    const secret2 = 'secret2';

    const enc1 = encryptSecret(secret1, masterKey);
    const enc2 = encryptSecret(secret2, masterKey);

    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);

    expect(decryptSecret(enc1, masterKey)).toBe(secret1);
    expect(decryptSecret(enc2, masterKey)).toBe(secret2);
  });

  it('should handle empty string', () => {
    const empty = '';
    const encrypted = encryptSecret(empty, masterKey);
    const decrypted = decryptSecret(encrypted, masterKey);

    expect(decrypted).toBe(empty);
  });

  it('should handle long secrets', () => {
    const longSecret = 'x'.repeat(10000);
    const encrypted = encryptSecret(longSecret, masterKey);
    const decrypted = decryptSecret(encrypted, masterKey);

    expect(decrypted).toBe(longSecret);
  });

  it('should handle special characters', () => {
    const specialSecret = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`"\'\\';
    const encrypted = encryptSecret(specialSecret, masterKey);
    const decrypted = decryptSecret(encrypted, masterKey);

    expect(decrypted).toBe(specialSecret);
  });
});
