/**
 * DataJud Periodic Cron Scheduler
 *
 * Schedules a repeating BullMQ job that triggers a full periodic sync
 * of all active processes across all tenants via the DataJud API.
 *
 * The cron pattern `0 2 * * *` runs daily at 02:00 UTC, satisfying the
 * default 24-hour interval requirement.
 *
 * A fixed `jobId` ensures BullMQ deduplicates the repeatable job entry —
 * calling `scheduleDataJudCron()` multiple times (e.g., server restarts)
 * will not create duplicate cron entries in the queue.
 *
 * Requirement: 7.2
 */

import { datajudSyncQueue } from '@/infrastructure/queues/queues';

/** Stable job ID used to prevent duplicate cron registrations. */
const CRON_JOB_ID = 'datajud-periodic-sync-cron';

/**
 * Registers the daily DataJud periodic-sync repeatable job.
 *
 * Should be called once on application startup (e.g., in the worker
 * bootstrap or a server initialisation hook). BullMQ's `jobId` deduplication
 * guarantees idempotency: if a repeatable job with this ID already exists
 * in Redis, it will not be duplicated.
 *
 * The worker that consumes this job must handle `type === 'periodic-sync'`
 * by fetching all active processes for all tenants and enqueueing individual
 * sync jobs (or processing them inline).
 */
export async function scheduleDataJudCron(): Promise<void> {
  await datajudSyncQueue.add(
    'periodic-sync',
    {
      type: 'periodic-sync',
      processId: 'ALL',
      tenantId: 'ALL',
      cnjNumber: '',
      triggerType: 'cron',
    },
    {
      jobId: CRON_JOB_ID,
      repeat: {
        pattern: '0 2 * * *', // Daily at 02:00 UTC — Requirement 7.2
      },
    },
  );
}
