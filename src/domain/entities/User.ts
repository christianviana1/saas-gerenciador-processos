/**
 * User — Domain entity for a platform user.
 *
 * Mirrors the Prisma `User` model as a plain TypeScript type with
 * business-level validation helpers.
 *
 * Requirements: 2.1, 4.5, 4.6, 4.8, 4.9, 17.2
 */

// ─────────────────────────────────────────────────────────────────────────────
// Enums (mirror Prisma enums)
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole =
  | 'SUPER_ADMIN'
  | 'OFFICE_ADMIN'
  | 'LAWYER'
  | 'LEGAL_ASSISTANT'
  | 'INTERN'
  | 'READ_ONLY_USER';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING';

// ─────────────────────────────────────────────────────────────────────────────
// Entity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Domain representation of a platform user.
 * Field names mirror the Prisma schema (camelCase).
 *
 * Note: `passwordHash` and `mfaSecret` are included because domain services
 * (e.g. authentication use cases) need them. Presentation layers should strip
 * these fields before serialising responses.
 */
export interface User {
  id: string;
  /** Immutable after creation — enforced at the repository level */
  tenantId: string;
  email: string;
  name: string;
  /** Argon2id hash. Never store or log the plain-text password. */
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  mfaEnabled: boolean;
  /** AES-256-GCM encrypted TOTP secret. Null when MFA is not configured. */
  mfaSecret: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Soft-delete timestamp. Non-null means the account has been deactivated. */
  deletedAt: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data transfer objects
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateUserData {
  tenantId: string;
  email: string;
  name: string;
  /** Pre-hashed password (Argon2id). Callers must hash before passing here. */
  passwordHash: string;
  role: UserRole;
}

export interface UpdateUserData {
  name?: string;
  role?: UserRole;
  status?: UserStatus;
  mfaEnabled?: boolean;
  mfaSecret?: string | null;
  lastLoginAt?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Business validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Password policy (Requirement 4.5):
 *  - At least 12 characters
 *  - At least one uppercase letter
 *  - At least one lowercase letter
 *  - At least one digit
 *  - At least one special character
 */
const PASSWORD_POLICY = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

/**
 * Returns `true` when a plain-text password meets the platform's password policy.
 *
 * Requirement 4.5
 */
export function isValidPassword(password: string): boolean {
  if (typeof password !== 'string') return false;
  return PASSWORD_POLICY.test(password);
}

/** Returns `true` when the user account is active (not soft-deleted or inactive). */
export function isUserActive(user: Pick<User, 'status' | 'deletedAt'>): boolean {
  return user.status === 'ACTIVE' && user.deletedAt === null;
}

/**
 * Hierarchy levels for privilege-escalation checks (Requirement 2.8).
 * Matches `ROLE_HIERARCHY` in PermissionMatrix.ts.
 */
export const USER_ROLE_HIERARCHY: Record<UserRole, number> = {
  READ_ONLY_USER: 1,
  INTERN: 2,
  LEGAL_ASSISTANT: 3,
  LAWYER: 4,
  OFFICE_ADMIN: 5,
  SUPER_ADMIN: 6,
};

/**
 * Returns `true` when `actor` has strictly higher authority than `target`.
 * Used to enforce Requirement 2.8 (no self-escalation, no peer-escalation).
 */
export function canManageRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return USER_ROLE_HIERARCHY[actorRole] > USER_ROLE_HIERARCHY[targetRole];
}
