/**
 * Process — Domain entity for a judicial process (processo judicial).
 *
 * Mirrors the Prisma `Process` model as a plain TypeScript type with
 * business-level validation helpers.
 *
 * Requirements: 1.1, 6.1, 6.2, 6.3, 6.9, 17.2
 */

// ─────────────────────────────────────────────────────────────────────────────
// Enums (mirror Prisma enums)
// ─────────────────────────────────────────────────────────────────────────────

export type ProcessStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';

// ─────────────────────────────────────────────────────────────────────────────
// Entity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Domain representation of a judicial process.
 * Field names mirror the Prisma schema (camelCase).
 *
 * Invariants:
 *  - `tenantId` is immutable after creation (Requirement 6.9, 1.1)
 *  - `cnjNumber` must match the CNJ pattern NNNNNNN-DD.AAAA.J.TT.OOOO (Requirement 6.1)
 *  - `(cnjNumber, tenantId)` is unique within the platform (Requirement 6.8)
 *  - `responsibleUserIds` must contain at least one active user (Requirement 6.5)
 */
export interface Process {
  id: string;
  /** Immutable after creation. */
  tenantId: string;
  /** Format: NNNNNNN-DD.AAAA.J.TT.OOOO */
  cnjNumber: string;
  clientName: string;
  currentCourt: string | null;
  status: ProcessStatus;
  processClass: string;
  subject: string;
  description: string | null;
  /** Free-form string tags for filtering and categorisation */
  tags: string[] | null;
  /** IDs of users responsible for this process. Min 1 active user required. */
  responsibleUserIds: string[];
  /** Timestamp of the last successful DataJud sync */
  lastDatajudSyncAt: Date | null;
  /** SHA-256 hash of the last DataJud response — used by HashDetector */
  datajudHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Soft-delete timestamp. Non-null means the process has been logically deleted. */
  deletedAt: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data transfer objects
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateProcessData {
  /** Validated CNJ number (use CnjNumber.parse() before passing here). */
  cnjNumber: string;
  clientName: string;
  processClass: string;
  subject: string;
  responsibleUserIds: string[];
  currentCourt?: string;
  description?: string;
  tags?: string[];
}

export interface UpdateProcessData {
  clientName?: string;
  currentCourt?: string | null;
  status?: ProcessStatus;
  processClass?: string;
  subject?: string;
  description?: string | null;
  tags?: string[] | null;
  responsibleUserIds?: string[];
  lastDatajudSyncAt?: Date;
  datajudHash?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filters for listing / querying
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessFilters {
  status?: ProcessStatus;
  responsibleUserId?: string;
  currentCourt?: string;
  tags?: string[];
  createdFrom?: Date;
  createdTo?: Date;
  /** Full-text search on clientName, subject or processClass */
  search?: string;
  page?: number;
  pageSize?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Business validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** CNJ number format: NNNNNNN-DD.AAAA.J.TT.OOOO */
const CNJ_PATTERN = /^\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4}$/;

/**
 * Returns `true` when the string matches the CNJ number format.
 * Prefer `CnjNumber.parse()` for validated creation; this is a lightweight guard.
 *
 * Requirement 6.1
 */
export function isValidCnjNumber(value: string): boolean {
  if (typeof value !== 'string') return false;
  return CNJ_PATTERN.test(value.trim());
}

/**
 * Returns `true` when the process has been logically deleted (soft-deleted).
 *
 * Requirement 6.7
 */
export function isProcessDeleted(process: Pick<Process, 'deletedAt' | 'status'>): boolean {
  return process.deletedAt !== null || process.status === 'DELETED';
}

/**
 * Returns `true` when the last DataJud sync is considered stale (> 48 hours ago),
 * or when the process has never been synced.
 *
 * Requirement 7.8
 */
export function isDatajudSyncStale(
  process: Pick<Process, 'lastDatajudSyncAt'>,
  now: Date = new Date(),
): boolean {
  if (process.lastDatajudSyncAt === null) return true;
  const diffMs = now.getTime() - process.lastDatajudSyncAt.getTime();
  const fortyEightHoursMs = 48 * 60 * 60 * 1000;
  return diffMs > fortyEightHoursMs;
}
