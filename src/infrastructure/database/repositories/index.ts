/**
 * Infrastructure repository implementations — barrel export.
 *
 * Import from this module to access the singleton repository instances:
 *
 * ```typescript
 * import {
 *   processRepository,
 *   taskRepository,
 *   userRepository,
 *   auditRepository,
 * } from '@/infrastructure/database/repositories';
 * ```
 */

export { processRepository } from './ProcessRepository';
export { taskRepository } from './TaskRepository';
export { userRepository } from './UserRepository';
export { auditRepository } from './AuditRepository';
