import { randomBytes } from 'crypto';

/**
 * Domain service responsible for generating cryptographically secure tokens
 * used in the invitation flow (Invitation_Token).
 *
 * Requirement 4.1: The platform SHALL generate a unique, cryptographically secure
 * Invitation_Token with 72-hour validity when an Office_Admin creates an invitation.
 */
export class TokenGenerator {
  /**
   * Generates a cryptographically secure random token.
   *
   * Uses Node.js built-in `crypto.randomBytes(32)` which produces 32 bytes of
   * cryptographically strong pseudo-random data, encoded as a 64-character hex string.
   *
   * @returns A 64-character hex string (256 bits of entropy).
   */
  generateInvitationToken(): string {
    return randomBytes(32).toString('hex');
  }
}

/** Singleton instance for convenient use across the application. */
export const tokenGenerator = new TokenGenerator();
