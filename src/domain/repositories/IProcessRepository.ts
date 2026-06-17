/**
 * IProcessRepository — Repository contract for Process entities.
 *
 * Every method receives `tenantId` as a required parameter. Implementations
 * MUST apply `WHERE tenant_id = tenantId` in every query — this is the primary
 * enforcement point for multi-tenant data isolation.
 *
 * INVARIANTE: nenhum método deve retornar dados de tenant diferente do recebido.
 *
 * Requirements: 1.7, 6.6, 17.2
 */

import type {
  Process,
  CreateProcessData,
  UpdateProcessData,
  ProcessFilters,
} from '../entities/Process';

// ─────────────────────────────────────────────────────────────────────────────
// Shared pagination result type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic paginated query result.
 *
 * Used by all repository `findMany` methods to return consistent pagination
 * metadata alongside the item list.
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contract for all persistence operations on the `Process` aggregate.
 *
 * All methods receive `tenantId` as a mandatory last parameter and must apply it
 * as a non-negotiable filter — callers must never omit it.
 *
 * Design document reference:
 * ```typescript
 * export interface IProcessRepository {
 *   findById(id: string, tenantId: string): Promise<Process | null>;
 *   findMany(filters: ProcessFilters, tenantId: string): Promise<PaginatedResult<Process>>;
 *   create(data: CreateProcessData, tenantId: string): Promise<Process>;
 *   update(id: string, data: UpdateProcessData, tenantId: string): Promise<Process>;
 *   softDelete(id: string, tenantId: string): Promise<void>;
 * }
 * ```
 */
export interface IProcessRepository {
  /**
   * Find a single process by its ID within the given tenant.
   * Returns `null` when the process does not exist or belongs to a different tenant.
   */
  findById(id: string, tenantId: string): Promise<Process | null>;

  /**
   * Find a process by its CNJ number within the given tenant.
   * Returns `null` when not found.
   */
  findByCnjNumber(cnjNumber: string, tenantId: string): Promise<Process | null>;

  /**
   * List processes matching the given filters, scoped to the tenant.
   * Maximum pageSize is 50 (Requirement 6.6).
   */
  findMany(filters: ProcessFilters, tenantId: string): Promise<PaginatedResult<Process>>;

  /**
   * Create a new process belonging to the given tenant.
   * The `tenantId` is set at creation and never changes (Requirement 6.9).
   */
  create(data: CreateProcessData, tenantId: string): Promise<Process>;

  /**
   * Update mutable fields of an existing process within the given tenant.
   * Throws `NotFoundError` when the process does not exist in this tenant.
   */
  update(id: string, data: UpdateProcessData, tenantId: string): Promise<Process>;

  /**
   * Logically delete a process by setting `deletedAt = now()`.
   * All related data (court history, tasks, audit logs) is preserved.
   *
   * Requirement 6.7
   */
  softDelete(id: string, tenantId: string): Promise<void>;
}
