/**
 * IAuditRepository — Repository contract for AuditLog entities.
 *
 * Audit logs are append-only. There are no `update` or `delete` methods — this
 * is a deliberate design decision that mirrors Requirement 3.4 (immutability).
 *
 * Every read method receives `tenantId` as a required parameter. The `append`
 * method also receives `tenantId` to ensure the record is correctly associated.
 *
 * Requirements: 1.7, 3.1–3.6, 17.2
 */

import type { PaginatedResult } from './IProcessRepository';
import type { AuditLog, CreateAuditLogData, AuditLogFilters } from '../entities/AuditLog';

// ─────────────────────────────────────────────────────────────────────────────
// Repository interface
// ─────────────────────────────────────────────────────────────────────────────

export interface IAuditRepository {
  /**
   * Persist a new AuditLog record.
   *
   * Implementations MUST:
   *  - Compute `payloadHash` = SHA-256 over the serialised record fields
   *    before writing to the database (Requirement 3.4).
   *  - Set `timestamp = now()` server-side (not from the caller).
   *
   * This is the only write operation. There are intentionally no update or
   * delete methods on this repository.
   */
  append(data: CreateAuditLogData, tenantId: string | null): Promise<AuditLog>;

  /**
   * Find a single audit log entry by its ID.
   *
   * `tenantId` must match the record's `tenantId`. Pass `null` only when the
   * caller is a SUPER_ADMIN accessing platform-level events.
   */
  findById(id: string, tenantId: string | null): Promise<AuditLog | null>;

  /**
   * Query audit logs with filters, scoped to the given tenant.
   *
   * - Office_Admin passes their own `tenantId` (Requirement 3.5).
   * - Super_Admin may pass any tenant's ID (Requirement 3.6).
   * - Maximum pageSize is 100 per Requirement 3.5.
   *
   * Results are returned in descending timestamp order (most recent first).
   */
  findMany(filters: AuditLogFilters, tenantId: string | null): Promise<PaginatedResult<AuditLog>>;

  /**
   * Verify the integrity of a persisted audit log record by recomputing its
   * SHA-256 hash and comparing it to the stored `payloadHash`.
   *
   * Returns `true` when the record has not been tampered with.
   *
   * Requirement 3.4
   */
  verifyIntegrity(id: string, tenantId: string | null): Promise<boolean>;
}
