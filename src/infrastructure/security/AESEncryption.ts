import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // bytes
const AUTH_TAG_LENGTH = 16; // bytes
const KEY_LENGTH = 32; // bytes — 256-bit key from 64-char hex

/**
 * AES-256-GCM encryption/decryption service.
 *
 * Output format: `<iv_base64>:<authTag_base64>:<ciphertext_base64>`
 *
 * Requirements: 12.7, 4.6
 */
export class AESEncryption {
  /**
   * Resolves and validates the 32-byte key buffer.
   * Accepts a 64-character hex string (32 bytes) or defaults to AES_ENCRYPTION_KEY env var.
   */
  private resolveKey(key?: string): Buffer {
    const hexKey = key ?? process.env.AES_ENCRYPTION_KEY;

    if (!hexKey) {
      throw new Error(
        'AES encryption key is not configured. Set AES_ENCRYPTION_KEY environment variable (64-char hex) or pass a key explicitly.'
      );
    }

    if (hexKey.length !== 64) {
      throw new Error(
        `AES encryption key must be a 64-character hex string (32 bytes). Received ${hexKey.length} characters.`
      );
    }

    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
      throw new Error(
        'AES encryption key must contain only hexadecimal characters (0-9, a-f, A-F).'
      );
    }

    return Buffer.from(hexKey, 'hex');
  }

  /**
   * Encrypts a plaintext string using AES-256-GCM.
   *
   * @param plaintext - The string to encrypt.
   * @param key - Optional 64-char hex key (defaults to AES_ENCRYPTION_KEY env var).
   * @returns Encrypted string in the format `iv:authTag:ciphertext` (all base64).
   */
  encrypt(plaintext: string, key?: string): string {
    const keyBuffer = this.resolveKey(key);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, keyBuffer, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypts a ciphertext string produced by `encrypt()`.
   *
   * @param ciphertext - Encrypted string in the format `iv:authTag:ciphertext` (all base64).
   * @param key - Optional 64-char hex key (defaults to AES_ENCRYPTION_KEY env var).
   * @returns The original plaintext string.
   * @throws If the format is invalid, the key is wrong, or the auth tag check fails.
   */
  decrypt(ciphertext: string, key?: string): string {
    const keyBuffer = this.resolveKey(key);

    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error(
        'Invalid ciphertext format. Expected `iv:authTag:ciphertext` (all base64).'
      );
    }

    const [ivB64, authTagB64, encryptedB64] = parts;

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const encryptedData = Buffer.from(encryptedB64, 'base64');

    if (iv.length !== IV_LENGTH) {
      throw new Error(
        `Invalid IV length. Expected ${IV_LENGTH} bytes, got ${iv.length}.`
      );
    }

    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(
        `Invalid auth tag length. Expected ${AUTH_TAG_LENGTH} bytes, got ${authTag.length}.`
      );
    }

    const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}

/** Singleton instance — uses AES_ENCRYPTION_KEY from the environment by default. */
export const aesEncryption = new AESEncryption();
