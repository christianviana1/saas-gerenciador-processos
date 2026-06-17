/**
 * Task — Domain entity for a legal task on the Kanban board.
 *
 * Mirrors the Prisma `Task` model as a plain TypeScript type with
 * business-level validation helpers.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.9, 17.2
 */

// ─────────────────────────────────────────────────────────────────────────────
// Enums (mirror Prisma enums)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kanban board statuses in progression order (Requirement 9.1):
 *   TODO → IN_PROGRESS → REVIEW → DONE
 */
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';

/**
 * Task priority levels (Requirement 9.3):
 *   LOW | MEDIUM | HIGH | URGENT
 */
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

// ─────────────────────────────────────────────────────────────────────────────
// Entity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Domain representation of a legal task.
 * Field names mirror the Prisma schema (camelCase).
 *
 * Invariants:
 *  - `tenantId` is set at creation and immutable (Requirement 1.1)
 *  - `processId` is optional — a task can belong to a process or stand alone
 *  - TaskHistory entries are append-only and immutable (Requirement 9.9)
 */
export interface Task {
  id: string;
  tenantId: string;
  /** Optional: tasks can be standalone (not linked to a process) */
  processId: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  assigneeUserId: string | null;
  dueDate: Date | null;
  status: TaskStatus;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  /** Soft-delete timestamp. Non-null means the task has been logically deleted. */
  deletedAt: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TaskHistory — immutable status transition record (append-only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Immutable record of a single Kanban status transition.
 *
 * Requirement 9.4 — fields: taskId, fromStatus, toStatus, movedByUserId, movedAt.
 * Requirement 9.9 — history is immutable and preserved even after soft-delete.
 */
export interface TaskHistory {
  id: string;
  taskId: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  movedByUserId: string;
  movedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data transfer objects
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateTaskData {
  processId?: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  assigneeUserId?: string;
  dueDate?: Date;
  /** Defaults to 'TODO' when not supplied */
  status?: TaskStatus;
  createdByUserId: string;
}

export interface UpdateTaskData {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  assigneeUserId?: string | null;
  dueDate?: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filters for listing / querying
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskFilters {
  processId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeUserId?: string;
  dueDateFrom?: Date;
  dueDateTo?: Date;
  /** Include tasks whose dueDate is in the past and status is not DONE */
  overdue?: boolean;
  page?: number;
  pageSize?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Business validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid Kanban transitions (forward + allowed back-transitions):
 *
 *   TODO        → IN_PROGRESS
 *   IN_PROGRESS → REVIEW  | TODO
 *   REVIEW      → DONE    | IN_PROGRESS
 *   DONE        → REVIEW
 */
const VALID_TRANSITIONS: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> = new Map([
  ['TODO', new Set<TaskStatus>(['IN_PROGRESS'])],
  ['IN_PROGRESS', new Set<TaskStatus>(['REVIEW', 'TODO'])],
  ['REVIEW', new Set<TaskStatus>(['DONE', 'IN_PROGRESS'])],
  ['DONE', new Set<TaskStatus>(['REVIEW'])],
]);

/**
 * Returns `true` when transitioning from `from` to `to` is a valid Kanban move.
 *
 * Requirement 9.1
 */
export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}

/**
 * Returns `true` when the task has an overdue `dueDate`
 * and has not yet reached the DONE status.
 *
 * Requirement 9.5
 */
export function isTaskOverdue(task: Pick<Task, 'dueDate' | 'status'>, now: Date = new Date()): boolean {
  if (task.dueDate === null || task.status === 'DONE') return false;
  return task.dueDate.getTime() < now.getTime();
}

/**
 * Returns `true` when the task should trigger an immediate notification:
 * priority is URGENT and dueDate is within the next 24 hours.
 *
 * Requirement 9.6
 */
export function requiresImmediateNotification(
  task: Pick<Task, 'priority' | 'dueDate'>,
  now: Date = new Date(),
): boolean {
  if (task.priority !== 'URGENT' || task.dueDate === null) return false;
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;
  const diffMs = task.dueDate.getTime() - now.getTime();
  return diffMs >= 0 && diffMs <= twentyFourHoursMs;
}
