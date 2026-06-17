/**
 * AuditLog — Domain entity for immutable audit trail records.
 *
 * Mirrors the Prisma `AuditLog` model as a plain TypeScript type.
 * Audit log records are append-only — no update or delete is ever allowed.
 *
 * Requirements: 3.1, 3.2, 3.4, 17.2
 */

// ─────────────────────────────────────────────────────────────────────────────
// Entity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Immutable audit trail record.
 *
 * Field names mirror the Prisma schema (camelCase).
 *
 * Invariants (Requirement 3.4):
 *  - Records must never be modified or deleted after creation.
 *  - `payloadHash` (SHA-256) is calculated over the record fields at write
 *    time and can be verified at any later point to detect tampering.
 */
export interface AuditLog {
  id: string;
  /** The tenant that owns this record. Null for platform-level events (e.g. Super_Admin actions). */
  tenantId: string | null;
  /** The user who performed the action. Null for unauthenticated or system events. */
  userId: string | null;
  /** Machine-readable action identifier, e.g. "process:create", "user:login". */
  action: string;
  /** Type of resource affected, e.g. "Process", "Task", "User". */
  resourceType: string;
  /** ID of the specific resource affected. Null for collection-level or auth events. */
  resourceId: string | null;
  /** Timestamp of when the event occurred. */
  timestamp: Date;
  /** IPv4 or IPv6 address of the requester (max 45 chars for IPv6). */
  ipAddress: string;
  userAgent: string;
  /** Snapshot of the resource state before the action. Null for create events. */
  payloadBefore: Record<string, unknown> | null;
  /** Snapshot of the resource state after the action. Null for delete events. */
  payloadAfter: Record<string, unknown> | null;
  /**
   * SHA-256 hash of the record's content at creation time.
   * Used to verify immutability — recalculate and compare to detect tampering.
   *
   * Requirement 3.4
   */
  payloadHash: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data transfer object for creating audit log entries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input required to create a new AuditLog entry.
 * The `payloadHash` and `timestamp` are computed by the Audit_Service
 * implementation — callers do not supply them.
 */
export interface CreateAuditLogData {
  tenantId: string | null;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string;
  userAgent: string;
  payloadBefore?: Record<string, unknown>;
  payloadAfter?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filters for querying audit logs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Supported filter parameters for audit log queries.
 *
 * Requirement 3.5 — Office_Admin filters: userId, action, period, resourceType.
 * Requirement 3.6 — Super_Admin has the same filters for any tenant.
 */
export interface AuditLogFilters {
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  timestampFrom?: Date;
  timestampTo?: Date;
  page?: number;
  /** Max 100 per Requirement 3.5 */
  pageSize?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action constants — exhaustive list of auditable events (Requirement 3.1)
// ─────────────────────────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = {
  // Authentication
  USER_LOGIN: 'user:login',
  USER_LOGOUT: 'user:logout',
  AUTH_FAILURE: 'auth:failure',

  // Process
  PROCESS_CREATE: 'process:create',
  PROCESS_UPDATE: 'process:update',
  PROCESS_DELETE: 'process:delete',

  // Task
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_DELETE: 'task:delete',

  // User management
  PERMISSION_CHANGE: 'user:permission:change',
  INVITATION_SEND: 'invitation:send',
  INVITATION_ACCEPT: 'invitation:accept',
  INVITATION_REVOKE: 'invitation:revoke',

  // Process court changes
  COURT_CHANGE: 'process:court:change',

  // Tenant management
  TENANT_PLAN_CHANGE: 'tenant:plan:change',
  TENANT_BLOCK: 'tenant:block',
  TENANT_REACTIVATE: 'tenant:reactivate',

  // Security events
  CROSS_TENANT_ACCESS: 'security:cross-tenant-access',
  BRUTE_FORCE_LOCKOUT: 'security:brute-force-lockout',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
