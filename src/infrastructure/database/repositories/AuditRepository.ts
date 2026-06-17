/**
 * AuditRepository — Prisma implementation of IAuditRepository.
 *
 * Audit logs are append-only. There are no `update` or `delete` methods —
 * this mirrors Requirement 3.4 (immutability) at the repository level.
 *
 * INVARIANTE: Toda query de leitura aplica `WHERE tenant_id = tenantId`.
 * Exceção: SUPER_ADMIN pode passar `tenantId = null` para consultar todos os tenants.
 *
 * Requirements: 1.7, 3.1–3.6, 18.6
 */

import * as crypto from 'crypto';
import { prisma } from '@/infrastructure/database/prisma/client';
import type { IAuditRepository } from '@/domain/repositories/IAuditRepository';
import type { PaginatedResult } from '@/domain/repositories/IProcessRepository';
import type { AuditLog, CreateAuditLogData, AuditLogFilters } from '@/domain/entities/AuditLog';
import { NotFoundError } from '@/shared/errors/AppError';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum allowed page size for audit log queries (Requirement 3.5). */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_PAGE = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Integrity hash
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hash over the audit log record fields.
 *
 * The hash is deterministic: fields are serialised in a fixed order to ensure
 * that the same record always produces the same hash.
 *
 * Requirement 3.4 — payloadHash for tamper detection.
 */
function computePayloadHash(data: {
  tenantId: string | null;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string;
  userAgent: string;
  payloadBefore: Record<string, unknown> | null;
  payloadAfter: Record<string, unknown> | null;
}): string {
  const canonical = JSON.stringify({
    tenantId: data.tenantId ?? null,
    userId: data.userId ?? null,
    action: data.action,
    resourceType: data.resourceType,
    resourceId: data.resourceId ?? null,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent,
    payloadBefore: data.payloadBefore ?? null,
    payloadAfter: data.payloadAfter ?? null,
  });

  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper to cast a Prisma JsonValue to a domain-compatible object or null
// ─────────────────────────────────────────────────────────────────────────────

function jsonToRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper
// ─────────────────────────────────────────────────────────────────────────────

function mapToDomain(record: {
  id: string;
  tenantId: string | null;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  payloadBefore: unknown;
  payloadAfter: unknown;
  payloadHash: string;
}): AuditLog {
  return {
    id: record.id,
    tenantId: record.tenantId,
    userId: record.userId,
    action: record.action,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    timestamp: record.timestamp,
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    payloadBefore: jsonToRecord(record.payloadBefore),
    payloadAfter: jsonToRecord(record.payloadAfter),
    payloadHash: record.payloadHash,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository implementation
// ─────────────────────────────────────────────────────────────────────────────

class AuditRepositoryImpl implements IAuditRepository {
  /**
   * Persist a new AuditLog record.
   *
   * Computes `payloadHash` = SHA-256 over the serialised record fields
   * before writing to the database (Requirement 3.4).
   * Sets `timestamp = now()` server-side.
   *
   * This is the only write operation — there are no update or delete methods.
   */
  async append(data: CreateAuditLogData, tenantId: string | null): Promise<AuditLog> {
    const payloadBefore = data.payloadBefore ?? null;
    const payloadAfter = data.payloadAfter ?? null;

    const payloadHash = computePayloadHash({
      tenantId: tenantId ?? null,
      userId: data.userId ?? null,
      action: data.action,
      resourceType: data.resourceType,
      resourceId: data.resourceId ?? null,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      payloadBefore,
      payloadAfter,
    });

    const record = await prisma.auditLog.create({
      data: {
        tenantId: tenantId ?? null,
        userId: data.userId ?? null,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId ?? null,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        // Prisma JSON fields accept plain objects at runtime
        payloadBefore: (payloadBefore ?? undefined) as never,
        payloadAfter: (payloadAfter ?? undefined) as never,
        payloadHash,
        // `timestamp` defaults to now() in the schema
      },
    });

    return mapToDomain(record);
  }

  /**
   * Find a single audit log entry by its ID.
   *
   * Pass `tenantId = null` only when the caller is a SUPER_ADMIN accessing
   * platform-level events (Requirement 3.6).
   */
  async findById(id: string, tenantId: string | null): Promise<AuditLog | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { id };

    if (tenantId !== null) {
      // INVARIANTE: scope to the given tenant when tenantId is provided
      where['tenantId'] = tenantId;
    }
    // When tenantId is null (SUPER_ADMIN), no tenant filter is applied

    const record = await prisma.auditLog.findFirst({ where });

    return record ? mapToDomain(record) : null;
  }

  /**
   * Query audit logs with filters, scoped to the given tenant.
   *
   * - Office_Admin passes their own `tenantId` (Requirement 3.5).
   * - Super_Admin may pass `null` to query across all tenants (Requirement 3.6).
   * - Maximum pageSize is 100 per Requirement 3.5.
   * - Results are returned in descending timestamp order (most recent first).
   */
  async findMany(filters: AuditLogFilters, tenantId: string | null): Promise<PaginatedResult<AuditLog>> {
    const page = Math.max(1, filters.page ?? DEFAULT_PAGE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * pageSize;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    if (tenantId !== null) {
      // INVARIANTE: scope to the given tenant when tenantId is provided
      where['tenantId'] = tenantId;
    }
    // When tenantId is null (SUPER_ADMIN), no tenant filter is applied

    if (filters.userId !== undefined) {
      where['userId'] = filters.userId;
    }

    if (filters.action !== undefined) {
      where['action'] = { contains: filters.action };
    }

    if (filters.resourceType !== undefined) {
      where['resourceType'] = filters.resourceType;
    }

    if (filters.resourceId !== undefined) {
      where['resourceId'] = filters.resourceId;
    }

    if (filters.timestampFrom !== undefined || filters.timestampTo !== undefined) {
      where['timestamp'] = {};
      if (filters.timestampFrom !== undefined) {
        where['timestamp']['gte'] = filters.timestampFrom;
      }
      if (filters.timestampTo !== undefined) {
        where['timestamp']['lte'] = filters.timestampTo;
      }
    }

    const [records, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { timestamp: 'desc' },
      }),
      prisma.auditLog.count({ where }),
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
   * Verify the integrity of a persisted audit log record by recomputing its
   * SHA-256 hash and comparing it to the stored `payloadHash`.
   *
   * Returns `true` when the record has not been tampered with.
   *
   * Requirement 3.4
   */
  async verifyIntegrity(id: string, tenantId: string | null): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { id };

    if (tenantId !== null) {
      where['tenantId'] = tenantId;
    }

    const record = await prisma.auditLog.findFirst({ where });

    if (!record) {
      throw new NotFoundError(`Audit log '${id}' not found.`, { id, tenantId });
    }

    const expectedHash = computePayloadHash({
      tenantId: record.tenantId,
      userId: record.userId,
      action: record.action,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      payloadBefore: jsonToRecord(record.payloadBefore),
      payloadAfter: jsonToRecord(record.payloadAfter),
    });

    // Use timing-safe comparison to prevent timing attacks
    const storedHash = record.payloadHash;
    if (expectedHash.length !== storedHash.length) return false;

    return crypto.timingSafeEqual(
      Buffer.from(expectedHash, 'hex'),
      Buffer.from(storedHash, 'hex'),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

export const auditRepository = new AuditRepositoryImpl();
