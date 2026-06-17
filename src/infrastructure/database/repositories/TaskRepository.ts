/**
 * TaskRepository — Prisma implementation of ITaskRepository.
 *
 * INVARIANTE: Toda query aplica `WHERE tenant_id = tenantId` obrigatoriamente.
 * Nenhum dado de outro tenant pode ser retornado ou modificado.
 *
 * Requirements: 1.7, 9.1–9.9
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import type { ITaskRepository } from '@/domain/repositories/ITaskRepository';
import type { PaginatedResult } from '@/domain/repositories/IProcessRepository';
import type {
  Task,
  TaskHistory,
  CreateTaskData,
  UpdateTaskData,
  TaskFilters,
  TaskStatus,
} from '@/domain/entities/Task';
import { isValidTaskTransition } from '@/domain/entities/Task';
import { NotFoundError, ValidationError } from '@/shared/errors/AppError';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum allowed page size for task queries. */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_PAGE = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────────────────────────────────────

function mapToDomain(record: {
  id: string;
  tenantId: string;
  processId: string | null;
  title: string;
  description: string | null;
  priority: string;
  assigneeUserId: string | null;
  dueDate: Date | null;
  status: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): Task {
  return {
    id: record.id,
    tenantId: record.tenantId,
    processId: record.processId,
    title: record.title,
    description: record.description,
    priority: record.priority as Task['priority'],
    assigneeUserId: record.assigneeUserId,
    dueDate: record.dueDate,
    status: record.status as TaskStatus,
    createdByUserId: record.createdByUserId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
  };
}

function mapHistoryToDomain(record: {
  id: string;
  taskId: string;
  fromStatus: string;
  toStatus: string;
  movedByUserId: string;
  movedAt: Date;
}): TaskHistory {
  return {
    id: record.id,
    taskId: record.taskId,
    fromStatus: record.fromStatus as TaskStatus,
    toStatus: record.toStatus as TaskStatus,
    movedByUserId: record.movedByUserId,
    movedAt: record.movedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository implementation
// ─────────────────────────────────────────────────────────────────────────────

class TaskRepositoryImpl implements ITaskRepository {
  /**
   * Find a single task by ID, scoped to the tenant.
   * Returns null when not found or tenant mismatch.
   */
  async findById(id: string, tenantId: string): Promise<Task | null> {
    const record = await prisma.task.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
    });

    return record ? mapToDomain(record) : null;
  }

  /**
   * List tasks matching the given filters, scoped to the tenant.
   * Maximum pageSize is 50.
   * All queries filter `deletedAt: null` automatically.
   *
   * Requirement 9.7
   */
  async findMany(filters: TaskFilters, tenantId: string): Promise<PaginatedResult<Task>> {
    const page = Math.max(1, filters.page ?? DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    // Build the where clause — tenantId is always required
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {
      tenantId,        // INVARIANTE: filtro obrigatório
      deletedAt: null,  // Exclude soft-deleted records
    };

    if (filters.processId !== undefined) {
      where['processId'] = filters.processId;
    }

    if (filters.status !== undefined) {
      where['status'] = filters.status;
    }

    if (filters.priority !== undefined) {
      where['priority'] = filters.priority;
    }

    if (filters.assigneeUserId !== undefined) {
      where['assigneeUserId'] = filters.assigneeUserId;
    }

    if (filters.dueDateFrom !== undefined || filters.dueDateTo !== undefined) {
      where['dueDate'] = {};
      if (filters.dueDateFrom !== undefined) {
        where['dueDate']['gte'] = filters.dueDateFrom;
      }
      if (filters.dueDateTo !== undefined) {
        where['dueDate']['lte'] = filters.dueDateTo;
      }
    }

    if (filters.overdue === true) {
      // Tasks with past due date that are not DONE
      where['dueDate'] = { lt: new Date() };
      where['status'] = { not: 'DONE' };
    }

    const [records, total] = await Promise.all([
      prisma.task.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.task.count({ where }),
    ]);

    return {
      items: records.map(mapToDomain),
      total,
      page,
      pageSize,
      hasNextPage: skip + records.length < total,
    };
  }

  /**
   * Retrieve the full immutable history of status transitions for a task.
   * Results are in chronological ascending order.
   * Validates tenant ownership before returning history.
   *
   * Requirements 9.4, 9.9
   */
  async findHistory(taskId: string, tenantId: string): Promise<TaskHistory[]> {
    // Verify the task belongs to this tenant (including soft-deleted tasks, history is preserved)
    const task = await prisma.task.findFirst({
      where: { id: taskId, tenantId },
      select: { id: true },
    });

    if (!task) {
      throw new NotFoundError(`Task '${taskId}' not found in tenant '${tenantId}'.`, {
        taskId,
        tenantId,
      });
    }

    const records = await prisma.taskHistory.findMany({
      where: { taskId },
      orderBy: { movedAt: 'asc' },
    });

    return records.map(mapHistoryToDomain);
  }

  /**
   * Create a new task belonging to the given tenant.
   * Defaults status to 'TODO' when not supplied in data.
   */
  async create(data: CreateTaskData, tenantId: string): Promise<Task> {
    const record = await prisma.task.create({
      data: {
        tenantId,  // INVARIANTE: imutável após criação
        processId: data.processId ?? null,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority ?? 'MEDIUM',
        assigneeUserId: data.assigneeUserId ?? null,
        dueDate: data.dueDate ?? null,
        status: data.status ?? 'TODO',
        createdByUserId: data.createdByUserId,
      },
    });

    return mapToDomain(record);
  }

  /**
   * Update mutable fields (title, description, priority, assignee, dueDate).
   * Does NOT change task status — use `moveStatus` for Kanban transitions.
   * Throws NotFoundError when the task does not exist in this tenant.
   */
  async update(id: string, data: UpdateTaskData, tenantId: string): Promise<Task> {
    const existing = await prisma.task.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError(`Task '${id}' not found in tenant '${tenantId}'.`, { id, tenantId });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    if (data.title !== undefined) updateData['title'] = data.title;
    if (data.description !== undefined) updateData['description'] = data.description;
    if (data.priority !== undefined) updateData['priority'] = data.priority;
    if (data.assigneeUserId !== undefined) updateData['assigneeUserId'] = data.assigneeUserId;
    if (data.dueDate !== undefined) updateData['dueDate'] = data.dueDate;

    const record = await prisma.task.update({
      where: { id },
      data: updateData,
    });

    return mapToDomain(record);
  }

  /**
   * Transition a task to a new Kanban status and append an immutable
   * `TaskHistory` record.
   *
   * Validates the transition is allowed before persisting.
   * Throws ValidationError for invalid transitions.
   *
   * Requirement 9.4
   */
  async moveStatus(
    id: string,
    toStatus: TaskStatus,
    movedByUserId: string,
    tenantId: string,
  ): Promise<Task> {
    const existing = await prisma.task.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new NotFoundError(`Task '${id}' not found in tenant '${tenantId}'.`, { id, tenantId });
    }

    const fromStatus = existing.status as TaskStatus;

    if (!isValidTaskTransition(fromStatus, toStatus)) {
      throw new ValidationError(
        `Invalid task transition from '${fromStatus}' to '${toStatus}'.`,
        { taskId: id, fromStatus, toStatus },
      );
    }

    // Use a transaction to atomically update status and append history
    const [updatedTask] = await prisma.$transaction([
      prisma.task.update({
        where: { id },
        data: { status: toStatus },
      }),
      prisma.taskHistory.create({
        data: {
          taskId: id,
          fromStatus,
          toStatus,
          movedByUserId,
        },
      }),
    ]);

    return mapToDomain(updatedTask);
  }

  /**
   * Logically delete a task by setting `deletedAt = now()`.
   * TaskHistory is preserved (Requirement 9.9).
   * Throws NotFoundError when the task does not exist in this tenant.
   */
  async softDelete(id: string, tenantId: string): Promise<void> {
    const existing = await prisma.task.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError(`Task '${id}' not found in tenant '${tenantId}'.`, { id, tenantId });
    }

    await prisma.task.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

export const taskRepository = new TaskRepositoryImpl();
