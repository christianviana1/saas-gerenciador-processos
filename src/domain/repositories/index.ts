/**
 * Domain repository interfaces — barrel export.
 *
 * Import from this module to access all repository contracts:
 *
 * ```typescript
 * import type {
 *   IProcessRepository,
 *   ITaskRepository,
 *   IUserRepository,
 *   IAuditRepository,
 *   PaginatedResult,
 * } from '@/domain/repositories';
 * ```
 */

export type { PaginatedResult } from './IProcessRepository';
export type { IProcessRepository } from './IProcessRepository';
export type { ITaskRepository } from './ITaskRepository';
export type { IUserRepository, UserFilters } from './IUserRepository';
export type { IAuditRepository } from './IAuditRepository';
