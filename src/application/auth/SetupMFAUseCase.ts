/**
 * SetupMFAUseCase — TOTP-based MFA setup and management.
 *
 * Three operations are exposed:
 *
 *  • `initMFA(userId, tenantId)` — Generates a fresh TOTP secret, encrypts it
 *    with AES-256-GCM and saves it to `User.mfaSecret`.  MFA is NOT yet enabled
 *    (mfaEnabled remains false until the user confirms a valid TOTP code).
 *    Returns { qrUri, secret } so the client can render a QR code and optionally
 *    display the plain-text secret for manual entry.
 *
 *  • `confirmMFA(userId, tenantId, totpCode)` — Verifies that the code the user
 *    scanned / typed matches the stored encrypted secret and, on success, sets
 *    mfaEnabled = true.
 *
 *  • `disableMFA(userId, tenantId, totpCode)` — Verifies the code (proving the
 *    user still has access to their authenticator app) and, on success, clears
 *    mfaEnabled and wipes mfaSecret.
 *
 * Requirements: 5.4, 12.8
 */

import { prisma }       from '@/infrastructure/database/prisma/client';
import { totpService }  from '@/infrastructure/security/TOTPService';
import { aesEncryption } from '@/infrastructure/security/AESEncryption';
import { NotFoundError, ValidationError } from '@/shared/errors/AppError';

// ─────────────────────────────────────────────────────────────────────────────
// Return types
// ─────────────────────────────────────────────────────────────────────────────

export interface InitMFAResult {
  /** otpauth:// URI ready for encoding into a QR code */
  qrUri: string;
  /** Plain-text TOTP secret — for manual entry into the authenticator app.
   *  NEVER persist or log this value; it is returned only once. */
  secret: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Use-case implementation
// ─────────────────────────────────────────────────────────────────────────────

export class SetupMFAUseCase {
  /**
   * Step 1 — Initialise MFA for a user.
   *
   * Generates a new TOTP secret, encrypts it with AES-256-GCM and saves it to
   * `User.mfaSecret`.  **MFA is not yet enabled** — the caller must follow up
   * with `confirmMFA()` once the user scans the QR code and supplies a valid
   * code.
   *
   * Calling `initMFA()` again before `confirmMFA()` is safe: the secret is
   * simply replaced.
   *
   * @param userId   - The user's database id.
   * @param tenantId - The user's tenant id (used to enforce tenant isolation).
   * @returns `{ qrUri, secret }` — display qrUri as a QR code; secret for manual entry.
   * @throws NotFoundError when the user does not exist in the given tenant.
   */
  async initMFA(userId: string, tenantId: string): Promise<InitMFAResult> {
    // Fetch the user — enforce tenant isolation
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new NotFoundError(
        `User '${userId}' not found in tenant '${tenantId}'.`,
        { userId, tenantId },
      );
    }

    // Generate a fresh 160-bit base32 TOTP secret
    const plaintextSecret = totpService.generateSecret();

    // Build the otpauth:// URI for the authenticator app
    const qrUri = totpService.generateQRUri(plaintextSecret, user.email);

    // Encrypt the secret with AES-256-GCM before persisting
    const encryptedSecret = aesEncryption.encrypt(plaintextSecret);

    // Persist — mfaEnabled remains false until confirmMFA succeeds
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaSecret: encryptedSecret,
        // mfaEnabled intentionally left unchanged — user must confirm first
      },
    });

    return { qrUri, secret: plaintextSecret };
  }

  /**
   * Step 2 — Confirm MFA setup.
   *
   * Verifies the 6-digit TOTP code the user obtained by scanning the QR code
   * from `initMFA()`.  On success, sets `mfaEnabled = true`.
   *
   * @param userId    - The user's database id.
   * @param tenantId  - The user's tenant id.
   * @param totpCode  - The 6-digit TOTP code entered by the user.
   * @throws NotFoundError   when the user does not exist or MFA was not initialised.
   * @throws ValidationError when the TOTP code is invalid.
   */
  async confirmMFA(userId: string, tenantId: string, totpCode: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true, mfaSecret: true },
    });

    if (!user) {
      throw new NotFoundError(
        `User '${userId}' not found in tenant '${tenantId}'.`,
        { userId, tenantId },
      );
    }

    if (!user.mfaSecret) {
      throw new ValidationError(
        'MFA has not been initialised for this user. Call initMFA() first.',
        { userId },
      );
    }

    // Decrypt the stored secret and verify the code
    const plaintextSecret = aesEncryption.decrypt(user.mfaSecret);
    const isValid = totpService.verify(totpCode, plaintextSecret);

    if (!isValid) {
      throw new ValidationError(
        'Invalid TOTP code. Please check your authenticator app and try again.',
        { userId },
      );
    }

    // Code is valid — enable MFA
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true },
    });
  }

  /**
   * Disable MFA for a user.
   *
   * Requires the user to supply a valid TOTP code to prove they still control
   * the authenticator app before wiping the secret.
   *
   * @param userId    - The user's database id.
   * @param tenantId  - The user's tenant id.
   * @param totpCode  - The 6-digit TOTP code entered by the user.
   * @throws NotFoundError   when the user does not exist or MFA is not configured.
   * @throws ValidationError when the TOTP code is invalid.
   */
  async disableMFA(userId: string, tenantId: string, totpCode: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: { id: true, mfaEnabled: true, mfaSecret: true },
    });

    if (!user) {
      throw new NotFoundError(
        `User '${userId}' not found in tenant '${tenantId}'.`,
        { userId, tenantId },
      );
    }

    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new ValidationError(
        'MFA is not enabled for this user.',
        { userId },
      );
    }

    // Decrypt and verify before disabling
    const plaintextSecret = aesEncryption.decrypt(user.mfaSecret);
    const isValid = totpService.verify(totpCode, plaintextSecret);

    if (!isValid) {
      throw new ValidationError(
        'Invalid TOTP code. Please check your authenticator app and try again.',
        { userId },
      );
    }

    // Wipe MFA completely
    await prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
      },
    });
  }
}

/** Singleton instance — import this for use in Server Actions and API routes. */
export const setupMFAUseCase = new SetupMFAUseCase();
