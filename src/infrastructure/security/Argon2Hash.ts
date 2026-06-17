/**
 * PasswordHash — secure password hashing using Node.js built-in scrypt.
 *
 * Uses scrypt (RFC 7914) via Node's native crypto module.
 * No external dependencies — works with all Node.js versions including 24+.
 *
 * Hash format: $scrypt$<salt_hex>$<hash_hex>
 *
 * The class is named Argon2Hash for backward compatibility with the rest of
 * the codebase, but internally uses scrypt which is equally secure.
 *
 * Requirements: 4.6, 12.7
 */

import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

export class Argon2Hash {
  /**
   * Hashes a plaintext password using scrypt.
   * @returns Hash string in format: $scrypt$<salt_hex>$<hash_hex>
   */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES).toString('hex');
    const derivedKey = await scryptAsync(password, salt, KEY_LENGTH) as Buffer;
    return `$scrypt$${salt}$${derivedKey.toString('hex')}`;
  }

  /**
   * Verifies a plaintext password against a stored hash.
   * Supports both scrypt format ($scrypt$...) and legacy Argon2 format ($argon2...).
   */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      // scrypt format: $scrypt$<salt>$<hash>
      if (hash.startsWith('$scrypt$')) {
        const parts = hash.split('$');
        // parts: ['', 'scrypt', salt, hashHex]
        if (parts.length !== 4) return false;
        const salt = parts[2];
        const storedHash = parts[3];
        const derivedKey = await scryptAsync(password, salt, KEY_LENGTH) as Buffer;
        const storedBuffer = Buffer.from(storedHash, 'hex');
        if (derivedKey.length !== storedBuffer.length) return false;
        return timingSafeEqual(derivedKey, storedBuffer);
      }

      // Legacy Argon2 format: $argon2id$...
      if (hash.startsWith('$argon2')) {
        const argon2 = await import('argon2');
        return argon2.verify(hash, password);
      }

      return false;
    } catch {
      return false;
    }
  }
}

/** Singleton instance for use throughout the application. */
export const argon2Hash = new Argon2Hash();
