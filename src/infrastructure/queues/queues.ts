/**
 * BullMQ Queue Definitions
 *
 * Defines the 4 background queues used by the platform:
 * - datajud-sync: DataJud/CNJ API synchronization jobs
 * - notifications: multi-channel notification delivery (in-app, email, push)
 * - audit: fire-and-forget audit log persistence (latency < 50ms to main flow)
 * - email: transactional email sending
 *
 * Requirements: 3.3, 7.7, 10.3
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// ─────────────────────────────────────────────────────────────────
// Redis Connection
// Shared connection instance reused by all queues and workers.
// BullMQ bundles its own ioredis — use connection options object to
// avoid type conflicts between the two ioredis versions.
// ─────────────────────────────────────────────────────────────────

const redisConnectionOptions = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
} as const;

// Separate IORedis instance for non-BullMQ uses (health checks, etc.)
export const redisConnection = new IORedis({
  ...redisConnectionOptions,
  lazyConnect: true,
});

// ─────────────────────────────────────────────────────────────────
// Job Type Interfaces
// ─────────────────────────────────────────────────────────────────

/**
 * Payload for DataJud synchronization jobs.
 * Supports initial discovery, scheduled periodic sync, and user-forced sync.
 */
export interface DataJudSyncJob {
  /** Job sub-type */
  type: 'initial-sync' | 'periodic-sync' | 'forced-sync';
  /** Process ID in the platform database */
  processId: string;
  /** Tenant ID — required for all queries */
  tenantId: string;
  /** CNJ number in format NNNNNNN-DD.AAAA.J.TT.OOOO */
  cnjNumber: string;
  /** Trigger context — cron, event-driven, or manual */
  triggerType?: 'cron' | 'event' | 'manual';
}

/**
 * Payload for notification delivery jobs.
 * Each job represents one notification to be delivered across enabled channels.
 */
export interface NotificationJob {
  /** Notification record ID already persisted in the database */
  notificationId: string;
  /** Destination user ID */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** Notification type — used to look up user channel preferences */
  type: string;
  /** Channels to attempt delivery on (resolved from user preferences by producer) */
  channels: Array<'in-app' | 'email' | 'push'>;
}

/**
 * Payload for audit log persistence jobs.
 * Mirrors the AuditEvent interface. Fire-and-forget: enqueued without awaiting.
 */
export interface AuditJob {
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

/**
 * Payload for email sending jobs.
 */
export interface EmailJob {
  /** Job sub-type */
  type: 'transactional' | 'invitation' | 'notification';
  /** Recipient email address */
  to: string;
  /** Email subject */
  subject: string;
  /** Template identifier */
  template: string;
  /** Template data / variables */
  data: Record<string, unknown>;
  /** Optional: tenant context for logging */
  tenantId?: string;
}

// ─────────────────────────────────────────────────────────────────
// Queue: datajud-sync
// Handles DataJud/CNJ API polling and process data synchronization.
//
// - attempts: 5 (1 initial + 4 retries with exponential backoff)
// - backoff: exponential, starting at 60 000ms (1 min → 2 → 4 → 8 → 16)
// - removeOnComplete: keep last 100 completed jobs
// - removeOnFail: keep last 50 failed jobs
//
// Requirement 7.7: DataJud calls must NEVER block user operations.
// ─────────────────────────────────────────────────────────────────
export const datajudSyncQueue = new Queue<DataJudSyncJob>('datajud-sync', {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 60_000, // 1 min, 2 min, 4 min, 8 min, 16 min
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

// ─────────────────────────────────────────────────────────────────
// Queue: notifications
// Multi-channel notification delivery: in-app, email, push.
//
// - attempts: 3
// - backoff: fixed 30 000ms (30 seconds between retries)
// - removeOnComplete: keep last 200 completed jobs
//
// Requirement 10.3: Notification delivery must be async via Queue_Worker,
// never blocking the originating event.
// ─────────────────────────────────────────────────────────────────
export const notificationsQueue = new Queue<NotificationJob>('notifications', {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 30_000, // 30 seconds
    },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  },
});

// ─────────────────────────────────────────────────────────────────
// Queue: audit
// Asynchronous audit log persistence. Fire-and-forget pattern.
//
// - attempts: 3
// - backoff: exponential starting at 5 000ms
// - removeOnComplete: keep last 500 completed jobs (more records for audit trail)
// - removeOnFail: false — NEVER discard failed audit jobs (compliance requirement)
//
// Requirement 3.3: Audit events must be recorded asynchronously with
// < 50ms latency impact on the main request flow.
// ─────────────────────────────────────────────────────────────────
export const auditQueue = new Queue<AuditJob>('audit', {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5_000, // 5s, 10s, 20s
    },
    removeOnComplete: { count: 500 },
    removeOnFail: false, // Audit failures must never be silently discarded
  },
});

// ─────────────────────────────────────────────────────────────────
// Queue: email
// Transactional email delivery (invitations, notifications, alerts).
//
// - attempts: 3
// - backoff: fixed 300 000ms (5 minutes between retries — avoids spam triggers)
// - removeOnComplete: keep last 100 completed jobs
//
// Requirement 10.5: Email delivery failures retry up to 3 times
// with 5-minute intervals, logging each failure.
// ─────────────────────────────────────────────────────────────────
export const emailQueue = new Queue<EmailJob>('email', {
  connection: redisConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 300_000, // 5 minutes
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});
