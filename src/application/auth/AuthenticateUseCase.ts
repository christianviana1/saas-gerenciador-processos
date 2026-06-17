/**
 * AuthenticateUseCase — Application layer orchestrator for user authentication.
 *
 * Orchestrates:
 *  1. Lockout check via Rate_Limiter (Requirement 5.5)
 *  2. User lookup by email (cross-tenant — email is unique per tenant, but we
 *     find the first non-deleted account matching the email)
 *  3. Status checks: user.status === 'ACTIVE', tenant.status === 'ACTIVE' (Requirement 1.5)
 *  4. Password verification via Argon2id (Requirement 4.6)
 *  5. MFA verification when enabled — decrypt AES-encrypted TOTP secret (Requirements 5.4, 12.8)
 *  6. Clear failed logins on success; record failure on any rejection (Requirement 5.5)
 *  7. Fire-and-forget audit event via BullMQ (Requirement 3.1, 3.3)
 *
 * NOTE: JWT issuance happens in Auth.js (src/auth.ts).
 * This use case provides pure verification logic, reusable and independently testable.
 *
 * Requirements: 5.1, 5.4, 5.5, 3.7
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import { argon2Hash } from '@/infrastructure/security/Argon2Hash';
import { totpService } from '@/infrastructure/security/TOTPService';
import { aesEncryption } from '@/infrastructure/security/AESEncryption';
import { rateLimiter } from '@/infrastructure/security/RateLimiter';
import { auditQueue } from '@/infrastructure/queues/queues';
import type { AuditJob } from '@/infrastructure/queues/queues';

// ─────────────────────────────────────────────────────────────────────────────
// Error types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Typed authentication error with a machine-readable code.
 * The code is safe to expose to callers for conditional UI rendering.
 */
export class AuthenticationError extends Error {
  readonly statusCode = 401;

  constructor(
    public readonly code:
      | 'ACCOUNT_LOCKED'
      | 'INVALID_CREDENTIALS'
      | 'USER_INACTIVE'
      | 'TENANT_BLOCKED'
      | 'MFA_REQUIRED'
      | 'MFA_INVALID_CODE'
      | 'MFA_CONFIGURATION_ERROR',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AuthenticationError';
    // Restore prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input / Output types
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthenticateInput {
  email: string;
  password: string;
  /** TOTP code — required when the user has MFA enabled */
  totpCode?: string;
  /** IP address of the requester — used in audit events */
  ipAddress: string;
  /** User-Agent header of the requester — used in audit events */
  userAgent: string;
}

/**
 * Verified identity returned on successful authentication.
 * The caller (Auth.js in src/auth.ts) uses this to mint the JWT.
 */
export interface AuthenticateResult {
  userId: string;
  tenantId: string;
  role: string;
  email: string;
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthenticateUseCase
// ─────────────────────────────────────────────────────────────────────────────

export class AuthenticateUseCase {
  /**
   * Executes the full authentication flow.
   *
   * @throws {AuthenticationError} for any authentication failure
   */
  async execute(input: AuthenticateInput): Promise<AuthenticateResult> {
    const { ipAddress, userAgent } = input;
    const email = input.email.toLowerCase().trim();

    // ── Step 1: Lockout check ──────────────────────────────────────────────
    // Check before any DB query to short-circuit brute-force attempts immediately.
    // Requirement 5.5
    const isLocked = await rateLimiter.isLockedOut(email);
    if (isLocked) {
      // Fire audit event for lockout hit (Requirement 3.1)
      this.enqueueAuditEvent({
        tenantId: null,
        userId: null,
        action: 'auth:failure',
        resourceType: 'User',
        resourceId: null,
        ipAddress,
        userAgent,
        payloadAfter: { reason: 'ACCOUNT_LOCKED', email },
      });
      throw new AuthenticationError('ACCOUNT_LOCKED');
    }

    // ── Step 2: Find user by email (any tenant) ────────────────────────────
    const user = await prisma.user.findFirst({
      where: {
        email,
        deletedAt: null,
      },
      include: {
        tenant: true,
      },
    });

    // ── Step 3: User not found ────────────────────────────────────────────
    // Record failure and audit even for non-existent accounts (Requirement 3.7)
    if (!user) {
      await rateLimiter.recordFailedLogin(email);
      this.enqueueAuditEvent({
        tenantId: null,
        userId: null,
        action: 'auth:failure',
        resourceType: 'User',
        resourceId: null,
        ipAddress,
        userAgent,
        payloadAfter: { reason: 'USER_NOT_FOUND', email },
      });
      throw new AuthenticationError('INVALID_CREDENTIALS');
    }

    // ── Step 4a: Check user status ────────────────────────────────────────
    if (user.status !== 'ACTIVE') {
      await rateLimiter.recordFailedLogin(email);
      this.enqueueAuditEvent({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'auth:failure',
        resourceType: 'User',
        resourceId: user.id,
        ipAddress,
        userAgent,
        payloadAfter: { reason: 'USER_INACTIVE', userStatus: user.status },
      });
      throw new AuthenticationError('USER_INACTIVE');
    }

    // ── Step 4b: Check tenant status ──────────────────────────────────────
    // Requirement 1.5: blocked tenants must not allow any login
    if (user.tenant.status !== 'ACTIVE') {
      this.enqueueAuditEvent({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'auth:failure',
        resourceType: 'Tenant',
        resourceId: user.tenantId,
        ipAddress,
        userAgent,
        payloadAfter: { reason: 'TENANT_BLOCKED', tenantStatus: user.tenant.status },
      });
      throw new AuthenticationError('TENANT_BLOCKED');
    }

    // ── Step 5: Verify password (Argon2id) ────────────────────────────────
    // Requirement 4.6
    const passwordValid = await argon2Hash.verify(user.passwordHash, input.password);
    if (!passwordValid) {
      await rateLimiter.recordFailedLogin(email);
      this.enqueueAuditEvent({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'auth:failure',
        resourceType: 'User',
        resourceId: user.id,
        ipAddress,
        userAgent,
        payloadAfter: { reason: 'INVALID_PASSWORD' },
      });
      throw new AuthenticationError('INVALID_CREDENTIALS');
    }

    // ── Step 6: MFA verification ──────────────────────────────────────────
    // Requirements 5.4, 12.8
    if (user.mfaEnabled) {
      if (!input.totpCode) {
        // Signal to the caller that a TOTP code is required — not a failure
        throw new AuthenticationError('MFA_REQUIRED');
      }

      if (!user.mfaSecret) {
        // MFA enabled but secret not configured — treat as config error
        await rateLimiter.recordFailedLogin(email);
        this.enqueueAuditEvent({
          tenantId: user.tenantId,
          userId: user.id,
          action: 'auth:failure',
          resourceType: 'User',
          resourceId: user.id,
          ipAddress,
          userAgent,
          payloadAfter: { reason: 'MFA_CONFIGURATION_ERROR' },
        });
        throw new AuthenticationError('MFA_CONFIGURATION_ERROR');
      }

      // Decrypt AES-256-GCM encrypted TOTP secret stored in the database
      let plaintextSecret: string;
      try {
        plaintextSecret = aesEncryption.decrypt(user.mfaSecret);
      } catch {
        await rateLimiter.recordFailedLogin(email);
        this.enqueueAuditEvent({
          tenantId: user.tenantId,
          userId: user.id,
          action: 'auth:failure',
          resourceType: 'User',
          resourceId: user.id,
          ipAddress,
          userAgent,
          payloadAfter: { reason: 'MFA_CONFIGURATION_ERROR', detail: 'decrypt_failed' },
        });
        throw new AuthenticationError('MFA_CONFIGURATION_ERROR');
      }

      const totpValid = totpService.verify(input.totpCode, plaintextSecret);
      if (!totpValid) {
        await rateLimiter.recordFailedLogin(email);
        this.enqueueAuditEvent({
          tenantId: user.tenantId,
          userId: user.id,
          action: 'auth:failure',
          resourceType: 'User',
          resourceId: user.id,
          ipAddress,
          userAgent,
          payloadAfter: { reason: 'MFA_INVALID_CODE' },
        });
        throw new AuthenticationError('MFA_INVALID_CODE');
      }
    }

    // ── Step 7: Authentication successful ────────────────────────────────
    // Clear failed login counters (Requirement 5.5)
    await rateLimiter.clearFailedLogins(email);

    // Fire-and-forget success audit event (Requirement 3.1, 3.3)
    this.enqueueAuditEvent({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'user:login',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress,
      userAgent,
      payloadAfter: {
        email: user.email,
        role: user.role,
        mfaUsed: user.mfaEnabled,
      },
    });

    return {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      email: user.email,
      name: user.name,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Enqueues an audit event to the BullMQ audit queue.
   * Fire-and-forget: never awaited, never throws (Requirement 3.3 — < 50ms impact).
   */
  private enqueueAuditEvent(event: AuditJob): void {
    auditQueue.add('audit-event', event).catch((err: unknown) => {
      // Log the error but never let it bubble up and disrupt authentication
      console.error('[AuthenticateUseCase] Failed to enqueue audit event:', err);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton instance
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton for use throughout the application layer. */
export const authenticateUseCase = new AuthenticateUseCase();
