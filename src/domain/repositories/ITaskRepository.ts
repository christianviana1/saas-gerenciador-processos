/**
 * ITaskRepository — Repository contract for Task entities.
 *
 * Every method receives `tenantId` as a required parameter. Implementations
 * MUST apply `WHERE tenant_id = tenantId` in every query.
 *
 * Requirements: 1.7, 9.1–9.9, 17.2
 */

import type { PaginatedResult } from './IProcessRepository';
import type { Task, TaskHistory, CreateTaskData, UpdateTaskData, TaskFilters, TaskStatus } from '../entities/Task';

// ─────────────────────────────────────────────────────────────────────────────
// Repository interface
// ─────────────────────────────────────────────────────────────────────────────

export interface ITaskRepository {
  /**
   * Find a single task by its ID within the given tenant.
   * Returns `null` when not found or tenant mismatch.
   */
  findById(id: string, tenantId: string): Promise<Task | null>;

  /**
   * List tasks matching the given filters, scoped to the tenant.
   * Supports grouping by status, filtering by assignee, priority, dueDate.
   *
   * Requirement 9.7
   */
  findMany(filters: TaskFilters, tenantId: string): Promise<PaginatedResult<Task>>;

  /**
   * Retrieve the full immutable history of status transitions for a task.
   * Results are in chronological ascending order.
   *
   * Requirement 9.4, 9.9
   */
  findHistory(taskId: string, tenantId: string): Promise<TaskHistory[]>;

  /**
   * Create a new task belonging to the given tenant.
   * Defaults status to 'TODO' when not supplied in data.
   */
  create(data: CreateTaskData, tenantId: string): Promise<Task>;

  /**
   * Update mutable fields (title, description, priority, assignee, dueDate).
   * Does NOT change task status — use `moveStatus` for Kanban transitions.
   */
  update(id: string, data: UpdateTaskData, tenantId: string): Promise<Task>;

  /**
   * Transition a task to a new Kanban status and append an immutable
   * `TaskHistory` record.
   *
   * Implementations must validate the transition is allowed before persisting
   * (see `isValidTaskTransition` in the Task entity).
   *
   * Requirement 9.4
   */
  moveStatus(
    id: string,
    toStatus: TaskStatus,
    movedByUserId: string,
    tenantId: string,
  ): Promise<Task>;

  /**
   * Logically delete a task by setting `deletedAt = now()`.
   * TaskHistory is preserved (Requirement 9.9).
   */
  softDelete(id: string, tenantId: string): Promise<void>;
}
