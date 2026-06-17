/**
 * ActivateUserUseCase
 *
 * Handles the account activation flow for invited users:
 *  1. Validates the invitation token (not expired, not used, not revoked)
 *  2. Validates the password against the ActivateAccountSchema (Req 4.5)
 *  3. Hashes the password with Argon2id (Req 4.6)
 *  4. Creates the User record with the role from the invitation (Req 4.3)
 *  5. Marks the InvitationToken as used (usedAt = now) — invalidates it (Req 4.3)
 *  6. Creates a ConsentRecord for LGPD compliance (Req 13.1)
 *  7. Enqueues an audit event (fire-and-forget) (Req 3.1)
 *
 * Steps 4, 5, and 6 are wrapped in a single Prisma transaction to ensure
 * atomicity: either all succeed or none are persisted.
 *
 * Requirements: 4.3, 4.4, 4.5, 4.6, 13.1
 */

import { z } from 'zod';
import { prisma } from '@/infrastructure/database/prisma/client';
import { argon2Hash } from '@/infrastructure/security/Argon2Hash';
import { ValidationError } from '@/shared/errors';
import { auditQueue } from '@/infrastructure/queues/queues';
import type { UserRole } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Input / Output types
// ─────────────────────────────────────────────────────────────────────────────

export interface ActivateUserInput {
  /** Invitation token from the activation link */
  token: string;
  /** Full name the user wants to register */
  name: string;
  /** Plaintext password chosen by the user (never persisted) */
  password: string;
  /** IP address of the activating request (used for ConsentRecord and audit) */
  ipAddress: string;
  /** User-Agent header of the activating request */
  userAgent: string;
  /** Version of the Privacy Policy / Terms of Service accepted (Req 13.1) */
  policyVersion: string;
}

export interface ActivateUserOutput {
  userId: string;
  email: string;
  tenantId: string;
  role: UserRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// Password-policy Zod schema  (Req 4.5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ActivateAccountSchema enforces the platform's password policy:
 *   - Minimum 12 characters
 *   - At least one uppercase letter (A-Z)
 *   - At least one lowercase letter (a-z)
 *   - At least one digit (0-9)
 *   - At least one special character (non-alphanumeric)
 *
 * Validates: Requirement 4.5
 */
export const ActivateAccountSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name must be at most 255 characters'),

  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(
      /[^A-Za-z0-9]/,
      'Password must contain at least one special character',
    ),

  policyVersion: z
    .string()
    .min(1, 'Policy version is required')
    .max(20, 'Policy version must be at most 20 characters'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Use Case
// ─────────────────────────────────────────────────────────────────────────────

export class ActivateUserUseCase {
  /**
   * Executes the account activation flow.
   *
   * @param input - Activation payload including token, name, password, IP, UA and policy version.
   * @returns The newly created user's ID, email, tenantId and assigned role.
   * @throws ValidationError if the token is invalid/expired or the password does not meet policy.
   */
  async execute(input: ActivateUserInput): Promise<ActivateUserOutput> {
    const { token, name, password, ipAddress, userAgent, policyVersion } =
      input;

    // ── Step 1: Find a valid invitation token ──────────────────────────────
    // Valid = exists, not expired (expiresAt > now), not yet used (usedAt null),
    // and not revoked (revokedAt null).   (Req 4.4)
    const now = new Date();

    const invitation = await prisma.invitationToken.findFirst({
      where: {
        token,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });

    // ── Step 2: Reject missing / expired tokens ────────────────────────────
    // Req 4.4: return a clear message; do NOT reveal whether the token never
    // existed or has been used/revoked (to avoid enumeration).
    if (!invitation) {
      throw new ValidationError(
        'This invitation link is invalid or has already expired. ' +
          'Please ask your administrator to send a new invitation.',
        { field: 'token' },
      );
    }

    // ── Step 3: Validate password policy via Zod ───────────────────────────
    // Req 4.5: min 12 chars, uppercase, lowercase, digit, special char.
    const parseResult = ActivateAccountSchema.safeParse({
      name,
      password,
      policyVersion,
    });

    if (!parseResult.success) {
      const fieldErrors = parseResult.error.flatten().fieldErrors;
      throw new ValidationError(
        'The provided data does not meet the platform requirements.',
        { fieldErrors },
      );
    }

    // ── Step 4: Hash the password with Argon2id ────────────────────────────
    // Req 4.6: Argon2id with auto-generated 16-byte salt (handled by Argon2Hash).
    const passwordHash = await argon2Hash.hash(password);

    // ── Steps 5, 6, 7: Atomic transaction ─────────────────────────────────
    // 5. Create User with role from invitation, status ACTIVE
    // 6. Mark InvitationToken as used (usedAt = now)
    // 7. Create ConsentRecord   (Req 13.1)
    const createdUser = await prisma.$transaction(async (tx) => {
      // 5 — Create User
      const user = await tx.user.create({
        data: {
          tenantId: invitation.tenantId,
          email: invitation.email,
          name: parseResult.data.name,
          passwordHash,
          role: invitation.role,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          email: true,
          tenantId: true,
          role: true,
        },
      });

      // 6 — Invalidate invitation token  (Req 4.3)
      await tx.invitationToken.update({
        where: { id: invitation.id },
        data: { usedAt: now },
      });

      // 7 — LGPD Consent Record  (Req 13.1)
      await tx.consentRecord.create({
        data: {
          userId: user.id,
          tenantId: invitation.tenantId,
          policyVersion: parseResult.data.policyVersion,
          ipAddress,
          userAgent,
        },
      });

      return user;
    });

    // ── Step 8: Enqueue audit event (fire-and-forget) ─────────────────────
    // Req 3.1: record INVITATION_ACCEPTED event.
    // Req 3.3: async, must not block the response.
    void auditQueue.add('invitation-accepted', {
      tenantId: invitation.tenantId,
      userId: createdUser.id,
      action: 'INVITATION_ACCEPTED',
      resourceType: 'User',
      resourceId: createdUser.id,
      ipAddress,
      userAgent,
      payloadAfter: {
        userId: createdUser.id,
        email: createdUser.email,
        role: createdUser.role,
        policyVersion: parseResult.data.policyVersion,
      },
    });

    return {
      userId: createdUser.id,
      email: createdUser.email,
      tenantId: createdUser.tenantId,
      role: createdUser.role,
    };
  }
}

/** Singleton instance for use throughout the application. */
export const activateUserUseCase = new ActivateUserUseCase();
