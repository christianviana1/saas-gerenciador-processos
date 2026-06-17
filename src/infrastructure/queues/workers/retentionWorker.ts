/**
 * Retention Worker — LGPD Data Retention Policy Enforcement
 *
 * Implements Requirement 13.5:
 *   "THE Platform SHALL implementar política de retenção de dados, excluindo
 *    automaticamente dados pessoais de usuários inativos há mais de 5 anos
 *    após notificação prévia de 30 dias."
 *
 * This worker processes jobs from the `data-retention` BullMQ queue.
 * A cron job is scheduled daily at 03:00 UTC by `retentionScheduler.ts`.
 *
 * Processing logic (per job execution):
 *
 *  STEP 1 — Identify candidates
 *    Find all non-anonymised users where:
 *      - lastLoginAt < (now - 5 years)  OR
 *      - lastLoginAt IS NULL AND createdAt < (now - 5 years)
 *
 *  STEP 2 — 30-day warning (approaching threshold)
 *    For users inactive for at least (5 years − 30 days) but less than 5 years:
 *    create an in-app SYSTEM_ALERT notification warning them that their data
 *    will be anonymised in 30 days.  A notification is only created once per
 *    user (idempotency check via `resourceId` on existing SYSTEM_ALERT rows).
 *
 *  STEP 3 — Anonymise (past threshold)
 *    For users inactive for 5 years or more: call `anonymizeUserUseCase`.
 *    Each anonymisation is logged.  Failures are caught per-user so one
 *    failed anonymisation does not abort the rest of the batch.
 *
 * Requirements: 13.5
 */

import { Worker, type Job } from 'bullmq';
import { redisConnection } from '@/infrastructure/queues/queues';
import { prisma } from '@/infrastructure/database/prisma/client';
import { anonymizeUserUseCase } from '@/application/lgpd/AnonymizeUserUseCase';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Name of the BullMQ queue this worker consumes. */
export const RETENTION_QUEUE_NAME = 'data-retention';

/** Inactivity threshold before anonymisation: 5 years in milliseconds. */
const FIVE_YEARS_MS = 5 * 365.25 * 24 * 60 * 60 * 1000;

/** Warning lead time before anonymisation: 30 days in milliseconds. */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Marker stored as `resourceType` on the warning notification so we can
 * check whether a warning has already been sent for a given user without
 * adding a database column.
 */
const RETENTION_WARNING_RESOURCE_TYPE = 'data-retention-warning';

// ─────────────────────────────────────────────────────────────────────────────
// Job payload type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload for retention check jobs.
 *
 * The cron scheduler enqueues this with `type: 'daily-check'`.
 * A manual job can also specify `dryRun: true` to log candidates without
 * taking any action — useful for auditing before the first production run.
 */
export interface RetentionJob {
  type: 'daily-check';
  /** When true, log candidates but skip notifications and anonymisation. */
  dryRun?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────────────────────────

export const retentionWorker = new Worker<RetentionJob>(
  RETENTION_QUEUE_NAME,
  async (job: Job<RetentionJob>) => {
    const dryRun = job.data.dryRun ?? false;
    const now = new Date();

    // ── Timestamps used to classify users ──────────────────────────────────
    // fiveYearsAgo    : users inactive since this date qualify for anonymisation
    // warningThreshold: users inactive since this date qualify for the 30-day warning
    const fiveYearsAgo = new Date(now.getTime() - FIVE_YEARS_MS);
    const warningThreshold = new Date(now.getTime() - (FIVE_YEARS_MS - THIRTY_DAYS_MS));

    console.info(
      JSON.stringify({
        level: 'info',
        service: 'retentionWorker',
        jobId: job.id,
        message: 'Retention check started',
        dryRun,
        fiveYearsAgo: fiveYearsAgo.toISOString(),
        warningThreshold: warningThreshold.toISOString(),
        timestamp: now.toISOString(),
      }),
    );

    // ── STEP 1: Find all candidates ─────────────────────────────────────────
    //
    // We query users that:
    //   a) are NOT already anonymised (email doesn't end with @deleted.invalid)
    //   b) have no deletedAt set (not already soft-deleted for other reasons)
    //   c) have lastLoginAt before warningThreshold OR
    //      (lastLoginAt is null AND createdAt before warningThreshold)
    //
    // This retrieves both the warning-zone and the anonymise-zone in one query
    // to avoid two heavy table scans.

    const candidates = await prisma.user.findMany({
      where: {
        deletedAt: null,
        // Exclude already-anonymised users (set by AnonymizeUserUseCase)
        NOT: {
          email: { endsWith: '@deleted.invalid' },
        },
        OR: [
          // Has logged in, but last login is older than 30-day warning threshold
          {
            lastLoginAt: { lt: warningThreshold },
          },
          // Never logged in, but account is older than the warning threshold
          {
            lastLoginAt: null,
            createdAt: { lt: warningThreshold },
          },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        name: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (candidates.length === 0) {
      console.info(
        JSON.stringify({
          level: 'info',
          service: 'retentionWorker',
          jobId: job.id,
          message: 'No retention candidates found',
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    // Separate candidates into two buckets:
    //   - toAnonymise : inactive >= 5 years → anonymise now
    //   - toWarn      : inactive >= (5 years - 30 days) but < 5 years → send warning
    const toAnonymise: typeof candidates = [];
    const toWarn: typeof candidates = [];

    for (const user of candidates) {
      // Effective inactivity baseline: lastLoginAt if present, otherwise createdAt
      const inactiveSince = user.lastLoginAt ?? user.createdAt;
      const inactiveMs = now.getTime() - inactiveSince.getTime();

      if (inactiveMs >= FIVE_YEARS_MS) {
        toAnonymise.push(user);
      } else {
        // inactiveMs >= FIVE_YEARS_MS - THIRTY_DAYS_MS (guaranteed by the query)
        toWarn.push(user);
      }
    }

    console.info(
      JSON.stringify({
        level: 'info',
        service: 'retentionWorker',
        jobId: job.id,
        message: 'Retention candidates classified',
        totalCandidates: candidates.length,
        toAnonymise: toAnonymise.length,
        toWarn: toWarn.length,
        dryRun,
        timestamp: new Date().toISOString(),
      }),
    );

    if (dryRun) {
      console.info(
        JSON.stringify({
          level: 'info',
          service: 'retentionWorker',
          jobId: job.id,
          message: 'Dry-run mode — no actions taken',
          anonymiseCandidateIds: toAnonymise.map((u) => u.id),
          warnCandidateIds: toWarn.map((u) => u.id),
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    // ── STEP 2: Send 30-day warning notifications ───────────────────────────
    //
    // For each user in `toWarn`, create an in-app SYSTEM_ALERT notification
    // only if one has not already been sent (idempotency guard).
    // We check by querying for an existing notification with:
    //   - userId = user.id
    //   - resourceType = RETENTION_WARNING_RESOURCE_TYPE
    // This prevents duplicate warnings on consecutive daily runs.

    let warningsSent = 0;
    let warningsSkipped = 0;

    for (const user of toWarn) {
      try {
        // Idempotency: check if warning already sent for this user
        const existingWarning = await prisma.notification.findFirst({
          where: {
            userId: user.id,
            tenantId: user.tenantId,
            resourceType: RETENTION_WARNING_RESOURCE_TYPE,
          },
          select: { id: true },
        });

        if (existingWarning) {
          warningsSkipped++;
          continue;
        }

        // Create in-app warning notification (90-day expiry as per platform standard)
        const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

        await prisma.notification.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            type: 'SYSTEM_ALERT',
            title: 'Aviso de exclusão de dados pessoais',
            body:
              'Sua conta está inativa há mais de 4 anos e 11 meses. ' +
              'De acordo com a política de retenção de dados da plataforma (LGPD), ' +
              'seus dados pessoais serão anonimizados em 30 dias caso não haja atividade. ' +
              'Faça login para manter sua conta ativa.',
            resourceType: RETENTION_WARNING_RESOURCE_TYPE,
            resourceId: user.id,
            expiresAt,
          },
        });

        warningsSent++;

        console.info(
          JSON.stringify({
            level: 'info',
            service: 'retentionWorker',
            jobId: job.id,
            message: 'Retention warning notification sent',
            userId: user.id,
            tenantId: user.tenantId,
            timestamp: new Date().toISOString(),
          }),
        );
      } catch (warnError) {
        // A warning failure should not abort other users — log and continue.
        console.error(
          JSON.stringify({
            level: 'error',
            service: 'retentionWorker',
            jobId: job.id,
            message: 'Failed to send retention warning notification',
            userId: user.id,
            tenantId: user.tenantId,
            error: (warnError as Error).message,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }

    // ── STEP 3: Anonymise users past the 5-year threshold ──────────────────
    //
    // For each user in `toAnonymise`, call `anonymizeUserUseCase.execute()`.
    // Each call is wrapped in its own try/catch so a single failure does not
    // prevent other users from being anonymised in the same batch.

    let anonymised = 0;
    let anonymisationErrors = 0;

    for (const user of toAnonymise) {
      try {
        await anonymizeUserUseCase.execute({
          userId: user.id,
          tenantId: user.tenantId,
          // System-initiated anonymisation — no human requestor
          requestedByUserId: 'system',
          ipAddress: '0.0.0.0',
          userAgent: 'RetentionWorker/cron',
        });

        anonymised++;

        console.info(
          JSON.stringify({
            level: 'info',
            service: 'retentionWorker',
            jobId: job.id,
            message: 'User anonymised by retention policy',
            userId: user.id,
            tenantId: user.tenantId,
            inactiveSince: (user.lastLoginAt ?? user.createdAt).toISOString(),
            timestamp: new Date().toISOString(),
          }),
        );
      } catch (anonymiseError) {
        anonymisationErrors++;

        console.error(
          JSON.stringify({
            level: 'error',
            service: 'retentionWorker',
            jobId: job.id,
            message: 'Failed to anonymise user during retention check',
            userId: user.id,
            tenantId: user.tenantId,
            error: (anonymiseError as Error).message,
            stack: (anonymiseError as Error).stack,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }

    // ── Summary log ─────────────────────────────────────────────────────────
    console.info(
      JSON.stringify({
        level: 'info',
        service: 'retentionWorker',
        jobId: job.id,
        message: 'Retention check completed',
        warningsSent,
        warningsSkipped,
        anonymised,
        anonymisationErrors,
        timestamp: new Date().toISOString(),
      }),
    );

    // If any anonymisations failed, throw so BullMQ marks the job as failed
    // and retries according to the queue's backoff policy.
    if (anonymisationErrors > 0) {
      throw new Error(
        `Retention check completed with ${anonymisationErrors} anonymisation error(s). ` +
          'BullMQ will retry. Check logs for affected user IDs.',
      );
    }
  },
  {
    connection: redisConnection as any,
    // Concurrency 1: this is a heavy batch job; single-concurrency prevents
    // overlapping runs and avoids race conditions on the same user rows.
    concurrency: 1,
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────────

retentionWorker.on('failed', (job: Job<RetentionJob> | undefined, error: Error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      service: 'retentionWorker',
      jobId: job?.id ?? 'unknown',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }),
  );
});
