/**
 * TaskStatus — Value Object for task status in the Kanban board.
 *
 * Encapsulates the TaskStatus enum and enforces valid state transitions:
 *   TODO → IN_PROGRESS → REVIEW → DONE
 *
 * Back-transitions allowed:
 *   IN_PROGRESS → TODO  (re-open)
 *   REVIEW → IN_PROGRESS  (reject / send back)
 *   DONE → REVIEW  (re-open for final review)
 *
 * Requirements: 9.1
 */

import { ValidationError } from '@/shared/errors/ValidationError';

/**
 * The four Kanban statuses, in order of progression.
 *
 * Maps to the Prisma enum `TaskStatus` in the database schema:
 *   enum TaskStatus { TODO IN_PROGRESS REVIEW DONE }
 *
 * Display labels (Requirement 9.1):
 *   TODO        → "A Fazer"
 *   IN_PROGRESS → "Em Andamento"
 *   REVIEW      → "Revisão"
 *   DONE        → "Concluído"
 */
export enum TaskStatusEnum {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  REVIEW = 'REVIEW',
  DONE = 'DONE',
}

/** Human-readable Portuguese labels for UI display. */
export const TASK_STATUS_LABELS: Record<TaskStatusEnum, string> = {
  [TaskStatusEnum.TODO]: 'A Fazer',
  [TaskStatusEnum.IN_PROGRESS]: 'Em Andamento',
  [TaskStatusEnum.REVIEW]: 'Revisão',
  [TaskStatusEnum.DONE]: 'Concluído',
};

/**
 * Ordered progression for reference (Requirement 9.1 — "nesta ordem de progressão").
 * Index 0 is the first state, index 3 is the final state.
 */
export const TASK_STATUS_ORDER: readonly TaskStatusEnum[] = [
  TaskStatusEnum.TODO,
  TaskStatusEnum.IN_PROGRESS,
  TaskStatusEnum.REVIEW,
  TaskStatusEnum.DONE,
] as const;

/**
 * Adjacency map: each status maps to the set of statuses it may
 * transition to. Only listed transitions are valid.
 *
 * Forward transitions  (main Kanban flow):
 *   TODO → IN_PROGRESS
 *   IN_PROGRESS → REVIEW
 *   REVIEW → DONE
 *
 * Back-transitions  (re-open / reject):
 *   IN_PROGRESS → TODO
 *   REVIEW → IN_PROGRESS
 *   DONE → REVIEW
 */
const VALID_TRANSITIONS = new Map<TaskStatusEnum, Set<TaskStatusEnum>>([
  [TaskStatusEnum.TODO, new Set<TaskStatusEnum>([TaskStatusEnum.IN_PROGRESS])],
  [TaskStatusEnum.IN_PROGRESS, new Set<TaskStatusEnum>([TaskStatusEnum.REVIEW, TaskStatusEnum.TODO])],
  [TaskStatusEnum.REVIEW, new Set<TaskStatusEnum>([TaskStatusEnum.DONE, TaskStatusEnum.IN_PROGRESS])],
  [TaskStatusEnum.DONE, new Set<TaskStatusEnum>([TaskStatusEnum.REVIEW])],
]);

/**
 * Immutable value object that wraps a validated `TaskStatusEnum` value
 * and enforces valid Kanban state transitions.
 *
 * Usage:
 *   const status = TaskStatus.from('TODO');
 *   const next   = status.transitionTo('IN_PROGRESS'); // OK
 *   const bad    = status.transitionTo('DONE');        // throws ValidationError
 *
 *   // Check before transitioning:
 *   if (TaskStatus.canTransition('TODO', 'IN_PROGRESS')) { ... }
 */
export class TaskStatus {
  /** The underlying enum value. */
  readonly value: TaskStatusEnum;

  private constructor(value: TaskStatusEnum) {
    this.value = value;
  }

  // ─────────────────────────────────────────────────────────────────
  // Static factories
  // ─────────────────────────────────────────────────────────────────

  /**
   * Create a `TaskStatus` from a raw string (case-sensitive).
   *
   * @param raw - One of `'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'`.
   * @returns A new immutable `TaskStatus` instance.
   * @throws {ValidationError} When the value is not a valid TaskStatusEnum member.
   */
  static from(raw: string): TaskStatus {
    if (!Object.values(TaskStatusEnum).includes(raw as TaskStatusEnum)) {
      throw new ValidationError(
        `Invalid TaskStatus: "${raw}". ` +
          `Valid values are: ${Object.values(TaskStatusEnum).join(', ')}.`,
        { errorCode: 'TASK_STATUS_INVALID', status: raw },
      );
    }
    return new TaskStatus(raw as TaskStatusEnum);
  }

  /** Convenience factory — create a `TaskStatus` directly from the enum. */
  static of(value: TaskStatusEnum): TaskStatus {
    return new TaskStatus(value);
  }

  /** Returns the initial status for a newly created task. */
  static initial(): TaskStatus {
    return new TaskStatus(TaskStatusEnum.TODO);
  }

  // ─────────────────────────────────────────────────────────────────
  // Transition logic
  // ─────────────────────────────────────────────────────────────────

  /**
   * Return `true` when a direct transition from `from` to `to` is allowed,
   * without creating a `TaskStatus` instance.
   *
   * Useful for lightweight guards before calling `transitionTo()`.
   */
  static canTransition(from: TaskStatusEnum, to: TaskStatusEnum): boolean {
    return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
  }

  /**
   * Produce a new `TaskStatus` representing the target state, enforcing
   * that the transition from `this.value` to `target` is valid.
   *
   * This method does **not** mutate the current instance — value objects
   * are always immutable.
   *
   * @param target - The desired next status (string or enum).
   * @returns A new `TaskStatus` with `value === target`.
   * @throws {ValidationError} When the transition is not permitted.
   */
  transitionTo(target: TaskStatusEnum | string): TaskStatus {
    // Validate that target is a known enum value first.
    const next = TaskStatus.from(target as string);

    if (!TaskStatus.canTransition(this.value, next.value)) {
      const allowed = [...(VALID_TRANSITIONS.get(this.value) ?? [])];
      throw new ValidationError(
        `Cannot transition task from "${this.value}" to "${next.value}". ` +
          `Allowed transitions from "${this.value}": [${allowed.join(', ')}].`,
        { errorCode: 'TASK_STATUS_INVALID_TRANSITION', from: this.value, to: next.value },
      );
    }

    return next;
  }

  /**
   * Return `true` when this status can transition to `target`.
   * Convenient instance-level alias for the static `canTransition`.
   */
  canTransitionTo(target: TaskStatusEnum): boolean {
    return TaskStatus.canTransition(this.value, target);
  }

  /**
   * Return the set of status values this status can transition to.
   */
  allowedTransitions(): Set<TaskStatusEnum> {
    return VALID_TRANSITIONS.get(this.value) ?? new Set();
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  /** Returns the Portuguese display label for this status. */
  toLabel(): string {
    return TASK_STATUS_LABELS[this.value];
  }

  /** Returns the raw enum string (e.g. `'TODO'`). Useful for Prisma. */
  toString(): string {
    return this.value;
  }

  /** Value-equality comparison. */
  equals(other: TaskStatus): boolean {
    return this.value === other.value;
  }

  /** True when this is the terminal state (no further forward moves). */
  isDone(): boolean {
    return this.value === TaskStatusEnum.DONE;
  }

  /** True when this is the initial state. */
  isInitial(): boolean {
    return this.value === TaskStatusEnum.TODO;
  }
}
