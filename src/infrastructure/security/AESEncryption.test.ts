import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AESEncryption, aesEncryption } from './AESEncryption';

// A valid 64-char hex key (32 bytes)
const VALID_KEY = 'a'.repeat(64); // 'aaa...a' — 64 hex chars = 32 bytes
const ANOTHER_KEY = 'b'.repeat(64);

describe('AESEncryption', () => {
  let enc: AESEncryption;

  beforeEach(() => {
    enc = new AESEncryption();
  });

  // ── Output format ────────────────────────────────────────────────────────────

  describe('encrypt()', () => {
    it('returns a string with three colon-separated base64 segments', () => {
      const result = enc.encrypt('hello', VALID_KEY);
      const parts = result.split(':');
      expect(parts).toHaveLength(3);
      // Each part must be valid base64 (non-empty)
      parts.forEach((p) => expect(p.length).toBeGreaterThan(0));
    });

    it('produces a different ciphertext each call (random IV)', () => {
      const first = enc.encrypt('same plaintext', VALID_KEY);
      const second = enc.encrypt('same plaintext', VALID_KEY);
      expect(first).not.toBe(second);
    });

    it('encrypts an empty string without throwing', () => {
      expect(() => enc.encrypt('', VALID_KEY)).not.toThrow();
    });

    it('encrypts unicode / multi-byte characters correctly', () => {
      const plaintext = '⚖️ Processo Jurídico — Réu: João Ação nº 001';
      const ciphertext = enc.encrypt(plaintext, VALID_KEY);
      const decrypted = enc.decrypt(ciphertext, VALID_KEY);
      expect(decrypted).toBe(plaintext);
    });
  });

  // ── Round-trip ────────────────────────────────────────────────────────────────

  describe('decrypt()', () => {
    it('round-trips arbitrary plaintext back to the original', () => {
      const plaintext = 'sensitive-mfa-secret-abc123!@#';
      const ciphertext = enc.encrypt(plaintext, VALID_KEY);
      expect(enc.decrypt(ciphertext, VALID_KEY)).toBe(plaintext);
    });

    it('round-trips a long plaintext (1 KB)', () => {
      const plaintext = 'x'.repeat(1024);
      expect(enc.decrypt(enc.encrypt(plaintext, VALID_KEY), VALID_KEY)).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      const ciphertext = enc.encrypt('', VALID_KEY);
      expect(enc.decrypt(ciphertext, VALID_KEY)).toBe('');
    });

    it('throws when decrypting with a different key', () => {
      const ciphertext = enc.encrypt('secret', VALID_KEY);
      expect(() => enc.decrypt(ciphertext, ANOTHER_KEY)).toThrow();
    });

    it('throws when ciphertext is tampered (auth tag mismatch)', () => {
      const ciphertext = enc.encrypt('secret', VALID_KEY);
      const parts = ciphertext.split(':');
      // Flip a character in the ciphertext segment to simulate tampering
      parts[2] = parts[2].split('').reverse().join('');
      expect(() => enc.decrypt(parts.join(':'), VALID_KEY)).toThrow();
    });

    it('throws on malformed ciphertext (wrong number of segments)', () => {
      expect(() => enc.decrypt('onlyone', VALID_KEY)).toThrow(
        /Invalid ciphertext format/
      );
      expect(() => enc.decrypt('a:b', VALID_KEY)).toThrow(
        /Invalid ciphertext format/
      );
      expect(() => enc.decrypt('a:b:c:d', VALID_KEY)).toThrow(
        /Invalid ciphertext format/
      );
    });
  });

  // ── Key validation ────────────────────────────────────────────────────────────

  describe('key validation', () => {
    it('throws when no key provided and AES_ENCRYPTION_KEY env var is unset', () => {
      const original = process.env.AES_ENCRYPTION_KEY;
      delete process.env.AES_ENCRYPTION_KEY;
      try {
        expect(() => enc.encrypt('text')).toThrow(/key is not configured/i);
      } finally {
        if (original !== undefined) process.env.AES_ENCRYPTION_KEY = original;
      }
    });

    it('uses AES_ENCRYPTION_KEY env var when no key argument is passed', () => {
      const original = process.env.AES_ENCRYPTION_KEY;
      process.env.AES_ENCRYPTION_KEY = VALID_KEY;
      try {
        const ciphertext = enc.encrypt('hello from env key');
        expect(enc.decrypt(ciphertext)).toBe('hello from env key');
      } finally {
        if (original !== undefined) {
          process.env.AES_ENCRYPTION_KEY = original;
        } else {
          delete process.env.AES_ENCRYPTION_KEY;
        }
      }
    });

    it('throws when key is shorter than 64 hex chars', () => {
      expect(() => enc.encrypt('text', 'a'.repeat(63))).toThrow(
        /64-character hex/
      );
    });

    it('throws when key is longer than 64 hex chars', () => {
      expect(() => enc.encrypt('text', 'a'.repeat(65))).toThrow(
        /64-character hex/
      );
    });

    it('throws when key contains non-hex characters', () => {
      expect(() => enc.encrypt('text', 'z'.repeat(64))).toThrow(
        /hexadecimal characters/
      );
    });
  });

  // ── Singleton ────────────────────────────────────────────────────────────────

  describe('singleton aesEncryption', () => {
    it('is an instance of AESEncryption', () => {
      expect(aesEncryption).toBeInstanceOf(AESEncryption);
    });

    it('round-trips with explicit key via singleton', () => {
      const plaintext = 'singleton round-trip';
      const ciphertext = aesEncryption.encrypt(plaintext, VALID_KEY);
      expect(aesEncryption.decrypt(ciphertext, VALID_KEY)).toBe(plaintext);
    });
  });
});
