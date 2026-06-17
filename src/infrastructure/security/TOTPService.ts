/**
 * TOTPService — RFC 6238 TOTP implementation using otplib v12
 *
 * Compatible with Google Authenticator, Authy and other TOTP apps.
 * Generates otpauth:// URIs for QR code setup and verifies 6-digit tokens
 * with a tolerance window of ±1 step (±30 s) as required by Requirement 12.8.
 *
 * @see Requirements 5.4, 12.8
 */

import { authenticator } from 'otplib';

// Configure a window of 1 on both sides (current ±1 step = 90 s tolerance).
// This compensates for minor clock drift between client and server.
authenticator.options = { window: 1 };

const DEFAULT_ISSUER = 'LegalSaaS';

export class TOTPService {
  /**
   * Generates a cryptographically random base32 TOTP secret (160 bits / 20 bytes).
   *
   * Store the returned string encrypted (AES-256-GCM) in User.mfaSecret.
   */
  generateSecret(): string {
    return authenticator.generateSecret(20);
  }

  /**
   * Builds an `otpauth://totp/…` URI suitable for encoding into a QR code.
   *
   * @param secret  - The raw (unencrypted) TOTP secret returned by `generateSecret()`
   * @param email   - The account label shown inside the authenticator app
   * @param issuer  - The issuer name shown in the authenticator app (default: "LegalSaaS")
   */
  generateQRUri(secret: string, email: string, issuer: string = DEFAULT_ISSUER): string {
    return authenticator.keyuri(email, issuer, secret);
  }

  /**
   * Verifies a 6-digit TOTP token against a given secret.
   *
   * Uses the configured window of ±1 step to tolerate minor clock drift.
   * Returns `true` when the token is valid, `false` otherwise.
   *
   * @param token  - The 6-digit code entered by the user
   * @param secret - The raw (unencrypted) TOTP secret stored for the user
   */
  verify(token: string, secret: string): boolean {
    return authenticator.verify({ token, secret });
  }
}

/** Singleton instance — import this for use in application and use-case layers. */
export const totpService = new TOTPService();
