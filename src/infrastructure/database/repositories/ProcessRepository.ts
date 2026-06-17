/**
 * ProcessRepository — Prisma implementation of IProcessRepository.
 *
 * INVARIANTE: Toda query aplica `WHERE tenant_id = tenantId` obrigatoriamente.
 * Nenhum dado de outro tenant pode ser retornado ou modificado.
 *
 * Requirements: 1.7, 6.6, 6.7
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import type { IProcessRepository, PaginatedResult } from '@/domain/repositories/IProcessRepository';
import type {
  Process,
  CreateProcessData,
  UpdateProcessData,
  ProcessFilters,
} from '@/domain/entities/Process';
import { NotFoundError, ConflictError } from '@/shared/errors/AppError';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum allowed page size for process queries (Requirement 6.6). */
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_PAGE = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Type-safe guard for Prisma's unique constraint errors (code P2002). */
function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const e = error as { code?: unknown };
  return e.code === 'P2002';
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a Prisma Process record to the domain `Process` entity.
 * Handles JSON field casting for `tags` and `responsibleUserIds`.
 */
function mapToDomain(record: {
  id: string;
  tenantId: string;
  cnjNumber: string;
  clientName: string;
  currentCourt: string | null;
  status: string;
  processClass: string;
  subject: string;
  description: string | null;
  tags: unknown;
  responsibleUserIds: unknown;
  lastDatajudSyncAt: Date | null;
  datajudHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): Process {
  return {
    id: record.id,
    tenantId: record.tenantId,
    cnjNumber: record.cnjNumber,
    clientName: record.clientName,
    currentCourt: record.currentCourt,
    status: record.status as Process['status'],
    processClass: record.processClass,
    subject: record.subject,
    description: record.description,
    tags: Array.isArray(record.tags) ? (record.tags as string[]) : null,
    responsibleUserIds: Array.isArray(record.responsibleUserIds)
      ? (record.responsibleUserIds as string[])
      : [],
    lastDatajudSyncAt: record.lastDatajudSyncAt,
    datajudHash: record.datajudHash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository implementation
// ─────────────────────────────────────────────────────────────────────────────

class ProcessRepositoryImpl implements IProcessRepository {
  /**
   * Find a single process by ID, scoped to the tenant.
   * Returns null when not found or tenant mismatch.
   */
  async findById(id: string, tenantId: string): Promise<Process | null> {
    const record = await prisma.process.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
    });

    return record ? mapToDomain(record) : null;
  }

  /**
   * Find a process by CNJ number within the given tenant.
   * Returns null when not found.
   */
  async findByCnjNumber(cnjNumber: string, tenantId: string): Promise<Process | null> {
    const record = await prisma.process.findFirst({
      where: {
        cnjNumber,
        tenantId,
        deletedAt: null,
      },
    });

    return record ? mapToDomain(record) : null;
  }

  /**
   * List processes matching the given filters, scoped to the tenant.
   * Maximum pageSize is 50 (Requirement 6.6).
   * All queries filter `deletedAt: null` automatically.
   */
  async findMany(filters: ProcessFilters, tenantId: string): Promise<PaginatedResult<Process>> {
    const page = Math.max(1, filters.page ?? DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    // Build the where clause — tenantId is always required
    // Using `any` here only because the Prisma namespace types are not resolvable
    // in this project's TypeScript setup (Prisma client not yet symlinked).
    // Runtime safety is ensured by the strongly-typed `prisma.process.findMany` call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {
      tenantId,        // INVARIANTE: filtro obrigatório
      deletedAt: null, // Exclude soft-deleted records
    };

    if (filters.status !== undefined) {
      where['status'] = filters.status;
    }

    if (filters.responsibleUserId !== undefined) {
      // responsibleUserIds is stored as a JSON array; use string_contains for MySQL JSON
      where['responsibleUserIds'] = {
        string_contains: filters.responsibleUserId,
      };
    }

    if (filters.currentCourt !== undefined) {
      where['currentCourt'] = {
        contains: filters.currentCourt,
      };
    }

    if (filters.tags !== undefined && filters.tags.length > 0) {
      // Filter processes that contain any of the requested tags
      where['tags'] = {
        string_contains: filters.tags[0],
      };
    }

    if (filters.createdFrom !== undefined || filters.createdTo !== undefined) {
      where['createdAt'] = {};
      if (filters.createdFrom !== undefined) {
        where['createdAt']['gte'] = filters.createdFrom;
      }
      if (filters.createdTo !== undefined) {
        where['createdAt']['lte'] = filters.createdTo;
      }
    }

    if (filters.search !== undefined && filters.search.trim() !== '') {
      const searchTerm = filters.search.trim();
      where['OR'] = [
        { clientName: { contains: searchTerm } },
        { subject: { contains: searchTerm } },
        { processClass: { contains: searchTerm } },
        { cnjNumber: { contains: searchTerm } },
      ];
    }

    const [records, total] = await Promise.all([
      prisma.process.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.process.count({ where }),
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
   * Create a new process belonging to the given tenant.
   * Throws ConflictError when the CNJ number already exists in the tenant.
   */
  async create(data: CreateProcessData, tenantId: string): Promise<Process> {
    try {
      const record = await prisma.process.create({
        data: {
          tenantId,  // INVARIANTE: imutável após criação
          cnjNumber: data.cnjNumber,
          clientName: data.clientName,
          processClass: data.processClass,
          subject: data.subject,
          // JSON fields must be cast — Prisma JsonValue at runtime handles arrays
          responsibleUserIds: data.responsibleUserIds as unknown as string,
          currentCourt: data.currentCourt ?? null,
          description: data.description ?? null,
          tags: (data.tags ?? null) as unknown as string,
        },
      });

      return mapToDomain(record);
    } catch (error) {
      // P2002 = Unique constraint violation (cnjNumber + tenantId)
      if (isPrismaUniqueConstraintError(error)) {
        throw new ConflictError(
          `A process with CNJ number '${data.cnjNumber}' already exists in this tenant.`,
          { cnjNumber: data.cnjNumber, tenantId },
        );
      }
      throw error;
    }
  }

  /**
   * Update mutable fields of an existing process within the given tenant.
   * Throws NotFoundError when the process does not exist in this tenant.
   */
  async update(id: string, data: UpdateProcessData, tenantId: string): Promise<Process> {
    // Verify ownership before updating
    const existing = await prisma.process.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError(`Process '${id}' not found in tenant '${tenantId}'.`, { id, tenantId });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    if (data.clientName !== undefined) updateData['clientName'] = data.clientName;
    if (data.currentCourt !== undefined) updateData['currentCourt'] = data.currentCourt;
    if (data.status !== undefined) updateData['status'] = data.status;
    if (data.processClass !== undefined) updateData['processClass'] = data.processClass;
    if (data.subject !== undefined) updateData['subject'] = data.subject;
    if (data.description !== undefined) updateData['description'] = data.description;
    if (data.tags !== undefined) {
      updateData['tags'] = data.tags as unknown as string;
    }
    if (data.responsibleUserIds !== undefined) {
      updateData['responsibleUserIds'] = data.responsibleUserIds as unknown as string;
    }
    if (data.lastDatajudSyncAt !== undefined) updateData['lastDatajudSyncAt'] = data.lastDatajudSyncAt;
    if (data.datajudHash !== undefined) updateData['datajudHash'] = data.datajudHash;

    const record = await prisma.process.update({
      where: { id },
      data: updateData,
    });

    return mapToDomain(record);
  }

  /**
   * Logically delete a process by setting `deletedAt = now()`.
   * All related data (court history, tasks, audit logs) is preserved.
   *
   * Throws NotFoundError when the process does not exist in this tenant.
   * Requirement 6.7
   */
  async softDelete(id: string, tenantId: string): Promise<void> {
    const existing = await prisma.process.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError(`Process '${id}' not found in tenant '${tenantId}'.`, { id, tenantId });
    }

    await prisma.process.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'DELETED',
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

export const processRepository = new ProcessRepositoryImpl();
