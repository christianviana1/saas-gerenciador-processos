/**
 * UserRepository — Prisma implementation of IUserRepository.
 *
 * INVARIANTE: Toda query aplica `WHERE tenant_id = tenantId` obrigatoriamente.
 * Nenhum dado de outro tenant pode ser retornado ou modificado.
 *
 * Requirements: 1.7, 4.8, 4.9
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import type { IUserRepository, UserFilters } from '@/domain/repositories/IUserRepository';
import type { PaginatedResult } from '@/domain/repositories/IProcessRepository';
import type { User, CreateUserData, UpdateUserData } from '@/domain/entities/User';
import { NotFoundError, ConflictError } from '@/shared/errors/AppError';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_PAGE = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Mapper
// ─────────────────────────────────────────────────────────────────────────────

function mapToDomain(record: {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): User {
  return {
    id: record.id,
    tenantId: record.tenantId,
    email: record.email,
    name: record.name,
    passwordHash: record.passwordHash,
    role: record.role as User['role'],
    status: record.status as User['status'],
    mfaEnabled: record.mfaEnabled,
    mfaSecret: record.mfaSecret,
    lastLoginAt: record.lastLoginAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository implementation
// ─────────────────────────────────────────────────────────────────────────────

class UserRepositoryImpl implements IUserRepository {
  /**
   * Find a user by their ID within the given tenant.
   * Includes tenant status check to allow callers to verify the tenant is active.
   * Returns null when not found or tenant mismatch.
   */
  async findById(id: string, tenantId: string): Promise<User | null> {
    const record = await prisma.user.findFirst({
      where: {
        id,
        tenantId,  // INVARIANTE: filtro obrigatório
        deletedAt: null,
      },
      include: {
        // Include tenant to allow downstream checks of tenant status
        tenant: {
          select: { id: true, status: true },
        },
      },
    });

    return record ? mapToDomain(record) : null;
  }

  /**
   * Find a user by email within the given tenant.
   * Used for login and duplicate-email validation.
   * Returns null when not found.
   */
  async findByEmail(email: string, tenantId: string): Promise<User | null> {
    const record = await prisma.user.findFirst({
      where: {
        email,
        tenantId,  // INVARIANTE: filtro obrigatório
        deletedAt: null,
      },
    });

    return record ? mapToDomain(record) : null;
  }

  /**
   * List users belonging to the tenant, with optional filters.
   * Maximum pageSize is 50.
   */
  async findMany(filters: UserFilters, tenantId: string): Promise<PaginatedResult<User>> {
    const page = Math.max(1, filters.page ?? DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    // Build the where clause — tenantId is always required
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {
      tenantId,        // INVARIANTE: filtro obrigatório
      deletedAt: null, // Exclude soft-deleted accounts
    };

    if (filters.role !== undefined) {
      where['role'] = filters.role;
    }

    if (filters.status !== undefined) {
      where['status'] = filters.status;
    }

    if (filters.search !== undefined && filters.search.trim() !== '') {
      const searchTerm = filters.search.trim();
      where['OR'] = [
        { name: { contains: searchTerm } },
        { email: { contains: searchTerm } },
      ];
    }

    const [records, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
      }),
      prisma.user.count({ where }),
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
   * Create a new user in the given tenant.
   * Throws ConflictError when the email already exists in the tenant.
   */
  async create(data: CreateUserData, tenantId: string): Promise<User> {
    try {
      const record = await prisma.user.create({
        data: {
          tenantId,  // INVARIANTE: imutável após criação
          email: data.email,
          name: data.name,
          passwordHash: data.passwordHash,
          role: data.role,
          status: 'PENDING',
        },
      });

      return mapToDomain(record);
    } catch (error) {
      // P2002 = Unique constraint violation (email + tenantId)
      if (
        error !== null &&
        typeof error === 'object' &&
        (error as { code?: unknown }).code === 'P2002'
      ) {
        throw new ConflictError(
          `A user with email '${data.email}' already exists in this tenant.`,
          { email: data.email, tenantId },
        );
      }
      throw error;
    }
  }

  /**
   * Update mutable user fields (name, role, status, MFA settings, etc.).
   * Throws NotFoundError when the user does not exist in this tenant.
   */
  async update(id: string, data: UpdateUserData, tenantId: string): Promise<User> {
    const existing = await prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError(`User '${id}' not found in tenant '${tenantId}'.`, { id, tenantId });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};

    if (data.name !== undefined) updateData['name'] = data.name;
    if (data.role !== undefined) updateData['role'] = data.role;
    if (data.status !== undefined) updateData['status'] = data.status;
    if (data.mfaEnabled !== undefined) updateData['mfaEnabled'] = data.mfaEnabled;
    if (data.mfaSecret !== undefined) updateData['mfaSecret'] = data.mfaSecret;
    if (data.lastLoginAt !== undefined) updateData['lastLoginAt'] = data.lastLoginAt;

    const record = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    return mapToDomain(record);
  }

  /**
   * Soft-delete (deactivate) a user account by setting `deletedAt = now()`
   * and status to 'INACTIVE'.
   * All associated data (tasks, audit logs) is preserved (Requirement 4.9).
   * Throws NotFoundError when the user does not exist in this tenant.
   *
   * Requirement 4.8
   */
  async softDelete(id: string, tenantId: string): Promise<void> {
    const existing = await prisma.user.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundError(`User '${id}' not found in tenant '${tenantId}'.`, { id, tenantId });
    }

    await prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'INACTIVE',
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

export const userRepository = new UserRepositoryImpl();
