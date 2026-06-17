/**
 * Retention Cron Scheduler
 *
 * Registers a daily BullMQ repeatable job that triggers the LGPD data
 * retention policy check (Requirement 13.5).
 *
 * Schedule: every day at 03:00 UTC (`0 3 * * *`).
 *
 * The job is enqueued into the `data-retention` queue with a fixed `jobId`
 * to guarantee idempotency — calling `scheduleRetentionCron()` on every
 * server restart will not create duplicate cron entries in Redis.
 *
 * Call `scheduleRetentionCron()` once during application startup alongside
 * the other scheduler initialisations (see `src/infrastructure/queues/schedulers/index.ts`).
 *
 * Requirements: 13.5
 */

import { Queue } from "bullmq";
import { redisConnection } from "@/infrastructure/queues/queues";
import {
  RETENTION_QUEUE_NAME,
  type RetentionJob,
} from "@/infrastructure/queues/workers/retentionWorker";

// ─────────────────────────────────────────────────────────────────────────────
// Queue instance
//
// We create a lightweight Queue reference here purely for scheduling purposes.
// The worker in retentionWorker.ts consumes from this same queue name.
// ─────────────────────────────────────────────────────────────────────────────

export const retentionQueue = new Queue<RetentionJob>(RETENTION_QUEUE_NAME, {
  // Type assertion handles slight type mismatches between project's ioredis and bullmq's internal ioredis
  connection: redisConnection as any,
  defaultJobOptions: {
    // A single failure in the nightly run should be retried up to 3 times
    // with exponential backoff before the job is considered permanently failed.
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5 * 60 * 1000, // 5 min → 10 min → 20 min
    },
    removeOnComplete: { count: 30 }, // Keep last 30 completed runs (~1 month of history)
    removeOnFail: { count: 10 }, // Keep last 10 failures for post-mortem inspection
  },
});

/** Stable job ID to prevent duplicate cron registrations on restarts. */
const RETENTION_CRON_JOB_ID = "lgpd-data-retention-daily-cron";

/**
 * Registers the daily data-retention repeatable job.
 *
 * Idempotent: BullMQ deduplicates repeatable jobs by `jobId`, so this
 * function can safely be called on every application startup without
 * creating duplicate schedules.
 *
 * @example
 * // In your server startup / worker bootstrap file:
 * import { scheduleRetentionCron } from '@/infrastructure/queues/retentionScheduler';
 * await scheduleRetentionCron();
 */
export async function scheduleRetentionCron(): Promise<void> {
  await retentionQueue.add(
    "daily-check",
    {
      type: "daily-check",
    } satisfies RetentionJob,
    {
      jobId: RETENTION_CRON_JOB_ID,
      repeat: {
        // Daily at 03:00 UTC — chosen to run outside peak hours and after
        // the 02:00 UTC database backup window (Requirement 15.1).
        pattern: "0 3 * * *",
      },
    },
  );
}
