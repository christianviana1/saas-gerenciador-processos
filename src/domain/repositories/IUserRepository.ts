/**
 * IUserRepository — Repository contract for User entities.
 *
 * Every method receives `tenantId` as a required parameter. Implementations
 * MUST apply `WHERE tenant_id = tenantId` in every query.
 *
 * Requirements: 1.7, 4.8, 4.9, 17.2
 */

import type { PaginatedResult } from './IProcessRepository';
import type { User, UserRole, UserStatus, CreateUserData, UpdateUserData } from '../entities/User';

// ─────────────────────────────────────────────────────────────────────────────
// User-specific filter type
// ─────────────────────────────────────────────────────────────────────────────

export interface UserFilters {
  role?: UserRole;
  status?: UserStatus;
  /** Partial name or email match */
  search?: string;
  page?: number;
  pageSize?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository interface
// ─────────────────────────────────────────────────────────────────────────────

export interface IUserRepository {
  /**
   * Find a user by their ID within the given tenant.
   * Returns `null` when not found or tenant mismatch.
   */
  findById(id: string, tenantId: string): Promise<User | null>;

  /**
   * Find a user by email within the given tenant.
   * Used for login and duplicate-email validation.
   * Returns `null` when not found.
   */
  findByEmail(email: string, tenantId: string): Promise<User | null>;

  /**
   * List users belonging to the tenant, with optional filters.
   */
  findMany(filters: UserFilters, tenantId: string): Promise<PaginatedResult<User>>;

  /**
   * Create a new user in the given tenant.
   * The `tenantId` is immutable after creation.
   */
  create(data: CreateUserData, tenantId: string): Promise<User>;

  /**
   * Update mutable user fields (name, role, status, MFA settings, etc.).
   * Throws `NotFoundError` when the user does not exist in this tenant.
   */
  update(id: string, data: UpdateUserData, tenantId: string): Promise<User>;

  /**
   * Soft-delete (deactivate) a user account by setting `deletedAt = now()`
   * and status to 'INACTIVE'.
   * All associated data (tasks, audit logs) is preserved (Requirement 4.9).
   *
   * Requirement 4.8
   */
  softDelete(id: string, tenantId: string): Promise<void>;
}
