/**
 * BullMQ Queue Monitor
 *
 * Monitors the 4 platform queues (datajud-sync, notifications, audit, email)
 * and emits structured alerts when any queue accumulates more than 100 pending
 * (waiting) jobs.
 *
 * On threshold breach:
 *  1. Emits a structured JSON log at level 'warn' via the platform logger.
 *  2. Persists a SYSTEM_ALERT in-app notification for every SUPER_ADMIN user.
 *
 * APM Metrics Note:
 *  - Time-average response per queue and error rates should be tracked here
 *    via an APM tool such as Datadog (dd-trace), New Relic, or OpenTelemetry.
 *    Example integration points:
 *      · datadogMetrics.gauge('queue.waiting_count', waitingCount, [`queue:${name}`])
 *      · datadogMetrics.gauge('queue.failed_count', failedCount, [`queue:${name}`])
 *      · datadogMetrics.increment('queue.alert_triggered', [`queue:${name}`])
 *    When a proper APM agent is available, replace the TODO comments below with
 *    the appropriate metric emission calls.
 *
 * Requirements: 14.6, 14.7
 */

import {
  datajudSyncQueue,
  notificationsQueue,
  auditQueue,
  emailQueue,
} from '@/infrastructure/queues/queues'
import { createLogger } from '@/shared/logger/logger'
import { prisma } from '@/infrastructure/database/prisma/client'
import { type Queue } from 'bullmq'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Alert threshold — requirement 14.6 */
const WAITING_COUNT_THRESHOLD = 100

/** All queues monitored by this module. */
const MONITORED_QUEUES: Queue[] = [
  datajudSyncQueue,
  notificationsQueue,
  auditQueue,
  emailQueue,
]

const log = createLogger('queue-monitor')

// ─────────────────────────────────────────────────────────────────────────────
// Core monitor function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks every monitored queue.
 * For each queue whose `waitingCount` exceeds the threshold, this function:
 *   1. Emits a structured WARN log.
 *   2. Creates a SYSTEM_ALERT in-app notification for every SUPER_ADMIN user.
 *
 * The function never throws — all errors are caught and logged so a single
 * failing check does not abort subsequent queue checks.
 *
 * Requirements: 14.6
 */
export async function monitorQueues(): Promise<void> {
  for (const queue of MONITORED_QUEUES) {
    try {
      const waitingCount = await queue.getWaitingCount()
      const failedCount  = await queue.getFailedCount()

      // TODO: Emit Datadog/OpenTelemetry gauge metrics here, e.g.:
      // datadogMetrics.gauge('bullmq.queue.waiting_count', waitingCount, [`queue:${queue.name}`])
      // datadogMetrics.gauge('bullmq.queue.failed_count',  failedCount,  [`queue:${queue.name}`])

      if (waitingCount > WAITING_COUNT_THRESHOLD) {
        const alertPayload = {
          action:       'queue:alert:high_pending',
          queueName:    queue.name,
          waitingCount,
          failedCount,
          threshold:    WAITING_COUNT_THRESHOLD,
        }

        // 1. Structured WARN log (Req 14.6)
        log.warn(alertPayload, `Queue "${queue.name}" has ${waitingCount} pending jobs (threshold: ${WAITING_COUNT_THRESHOLD})`)

        // TODO: Increment Datadog alert counter here, e.g.:
        // datadogMetrics.increment('bullmq.queue.alert_triggered', [`queue:${queue.name}`])

        // 2. Create SYSTEM_ALERT notifications for all SUPER_ADMIN users (Req 14.6)
        await _notifySuperAdmins(queue.name, waitingCount, failedCount)
      }
    } catch (err) {
      log.error(
        {
          action:    'queue:monitor:error',
          queueName: queue.name,
          error:     err instanceof Error ? err.message : String(err),
        },
        `Failed to check queue "${queue.name}"`,
      )
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persists a SYSTEM_ALERT in-app Notification for every active SUPER_ADMIN
 * user in the platform (SUPER_ADMINs are not scoped to a single tenant, but
 * their user record still has a tenantId — we look them up across all tenants).
 *
 * Notifications are created in a single `createMany` call for efficiency.
 * Errors are swallowed after logging so the monitor loop keeps running.
 */
async function _notifySuperAdmins(
  queueName: string,
  waitingCount: number,
  failedCount: number,
): Promise<void> {
  try {
    const superAdmins = await prisma.user.findMany({
      where: {
        role:   'SUPER_ADMIN',
        status: 'ACTIVE',
      },
      select: {
        id:       true,
        tenantId: true,
      },
    })

    if (superAdmins.length === 0) {
      log.warn(
        { action: 'queue:alert:no_super_admins', queueName },
        'SYSTEM_ALERT queued but no active SUPER_ADMIN users found',
      )
      return
    }

    const now       = new Date()
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000) // 90 days

    const notifications = superAdmins.map((admin) => ({
      tenantId:     admin.tenantId,
      userId:       admin.id,
      type:         'SYSTEM_ALERT' as const,
      title:        `Alerta: fila "${queueName}" com ${waitingCount} jobs pendentes`,
      body:         JSON.stringify({
        message:      `A fila "${queueName}" acumulou ${waitingCount} jobs aguardando (limite: ${WAITING_COUNT_THRESHOLD}). Jobs com falha: ${failedCount}.`,
        queueName,
        waitingCount,
        failedCount,
        threshold:    WAITING_COUNT_THRESHOLD,
        detectedAt:   now.toISOString(),
      }),
      resourceType: 'queue',
      resourceId:   queueName,
      createdAt:    now,
      expiresAt,
    }))

    await prisma.notification.createMany({ data: notifications })

    log.warn(
      {
        action:             'queue:alert:notifications_created',
        queueName,
        waitingCount,
        failedCount,
        notifiedAdminCount: superAdmins.length,
      },
      `SYSTEM_ALERT notifications created for ${superAdmins.length} SUPER_ADMIN user(s)`,
    )
  } catch (err) {
    log.error(
      {
        action:    'queue:alert:notification_error',
        queueName,
        error:     err instanceof Error ? err.message : String(err),
      },
      'Failed to create SYSTEM_ALERT notifications for SUPER_ADMIN users',
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Interval-based monitoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts a periodic queue monitoring loop.
 *
 * Calls `monitorQueues()` immediately on start, then repeats every
 * `intervalMs` milliseconds (default: 60 000 ms / 1 minute).
 *
 * Returns the `NodeJS.Timeout` handle so callers can clear it if needed
 * (e.g. during graceful shutdown or in tests).
 *
 * @example
 * // In your worker entrypoint:
 * const monitor = startQueueMonitoring()
 *
 * // Graceful shutdown:
 * process.on('SIGTERM', () => clearInterval(monitor))
 *
 * @param intervalMs - Polling interval in milliseconds (default: 60 000)
 */
export function startQueueMonitoring(intervalMs = 60_000): NodeJS.Timeout {
  log.info(
    { action: 'queue:monitor:start', intervalMs },
    `Queue monitoring started — checking every ${intervalMs / 1000}s`,
  )

  // Run immediately on startup, then on the interval.
  void monitorQueues()

  return setInterval(() => {
    void monitorQueues()
  }, intervalMs)
}
