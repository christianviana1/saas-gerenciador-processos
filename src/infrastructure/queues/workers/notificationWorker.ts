/**
 * Notification Worker
 *
 * Consumes jobs from the `notifications` BullMQ queue and delivers each
 * notification across the channels the recipient has enabled.
 *
 * Channel behaviour:
 *  - in-app   : The Notification record is already persisted by the use case
 *               that triggered this job — no further action is needed here.
 *  - email    : Adds a job to the `emailQueue` with the notification data.
 *               BullMQ will retry up to 3 times with a 5-minute fixed backoff
 *               (configured on the queue definition in queues.ts).
 *  - push     : Delegates to WebPushService when available.  If the service
 *               file does not exist yet (import resolves gracefully at runtime)
 *               the channel is skipped with a warning log — no exception is
 *               thrown and the job is not failed because of it.
 *
 * Concurrency: 10  — notification jobs involve 1 DB read + 1-3 queue enqueues;
 * concurrency 10 keeps latency low without overloading the DB connection pool.
 *
 * Requirements: 10.2, 10.3, 10.5
 */

import { Worker, type Job } from "bullmq";
import {
  notificationsQueue,
  emailQueue,
  redisConnection,
  type NotificationJob,
  type EmailJob,
} from "@/infrastructure/queues/queues";
import { prisma } from "@/infrastructure/database/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Optional push service — imported lazily so the worker starts correctly even
// when the WebPushService has not been implemented yet.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal interface expected from WebPushService. */
interface IWebPushService {
  sendToUser(userId: string, payload: Record<string, unknown>): Promise<void>;
}

/**
 * Attempts to load the WebPushService singleton.
 *
 * Returns `null` if the module is not present so the push channel is skipped
 * gracefully rather than crashing the worker process.
 */
async function loadWebPushService(): Promise<IWebPushService | null> {
  try {
    // Dynamic import — keeps the worker runnable when the file does not exist.
    const mod = await import("@/infrastructure/push/WebPushService");
    return (mod.webPushService as IWebPushService) ?? null;
  } catch {
    // Module not found — push channel not yet available.
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────────────────────────

export const notificationWorker = new Worker<NotificationJob>(
  notificationsQueue.name,
  async (job: Job<NotificationJob>) => {
    const { notificationId, userId, tenantId, type, channels } = job.data;

    // ── 1. Fetch the user's channel preferences for this notification type ──
    //
    // We look up the stored preference row; if none exists, we fall back to
    // the channels list provided in the job payload (resolved by the producer
    // from the same preference table at enqueue time).  This dual-check
    // ensures the worker honours the most up-to-date preference even if the
    // user changed settings between enqueue and consumption.

    let prefs: {
      channelEmail: boolean;
      channelPush: boolean;
      channelInApp: boolean;
    } | null = null;

    try {
      prefs = await prisma.userNotificationPreference.findUnique({
        where: {
          // Composite unique index: [userId, notificationType]
          userId_notificationType: {
            userId,
            notificationType: type as import("@prisma/client").NotificationType,
          },
        },
        select: {
          channelEmail: true,
          channelPush: true,
          channelInApp: true,
        },
      });
    } catch (dbError) {
      // Log and re-throw so BullMQ can retry the job.
      console.error(
        JSON.stringify({
          level: "error",
          service: "notificationWorker",
          jobId: job.id,
          notificationId,
          userId,
          tenantId,
          message: "Failed to fetch user notification preferences",
          error: (dbError as Error).message,
          timestamp: new Date().toISOString(),
        }),
      );
      throw dbError;
    }

    // Effective channel flags — prefer DB preferences; fall back to the
    // channels array from the job payload so we never silently drop a
    // delivery when the preference row was created after enqueueing.
    const emailEnabled =
      prefs !== null ? prefs.channelEmail : channels.includes("email");
    const pushEnabled =
      prefs !== null ? prefs.channelPush : channels.includes("push");

    // ── 2. Fetch the Notification record for use in payloads ──

    let notification: {
      title: string;
      body: string;
      resourceType: string | null;
      resourceId: string | null;
    } | null = null;

    try {
      notification = await prisma.notification.findUnique({
        where: { id: notificationId },
        select: {
          title: true,
          body: true,
          resourceType: true,
          resourceId: true,
        },
      });
    } catch (dbError) {
      console.error(
        JSON.stringify({
          level: "error",
          service: "notificationWorker",
          jobId: job.id,
          notificationId,
          userId,
          tenantId,
          message: "Failed to fetch notification record",
          error: (dbError as Error).message,
          timestamp: new Date().toISOString(),
        }),
      );
      throw dbError;
    }

    // ── 3. in-app channel ──
    //
    // The Notification record is already persisted by the use case — nothing
    // to do here.  The in-app badge / polling endpoint reads directly from DB.

    // ── 4. email channel ──
    //
    // Enqueue an EmailJob so the email worker handles SMTP delivery with its
    // own retry policy (3 attempts × 5-minute fixed backoff — Req 10.5).

    if (emailEnabled) {
      const emailPayload: EmailJob = {
        type: "notification",
        to: "", // The email worker must resolve the user's email from userId.
        // We pass userId+tenantId in `data` so the email worker can look it up.
        subject: notification?.title ?? `Notificação: ${type}`,
        template: "notification",
        data: {
          userId,
          tenantId,
          notificationId,
          type,
          title: notification?.title ?? "",
          body: notification?.body ?? "",
          resourceType: notification?.resourceType ?? null,
          resourceId: notification?.resourceId ?? null,
        },
        tenantId,
      };

      try {
        await emailQueue.add(
          `email:notification:${notificationId}`,
          emailPayload,
          {
            // Job-level overrides — inherit queue defaults (3 retries, 5 min backoff).
            jobId: `email:${notificationId}`, // idempotency: same notification → same email job id
          },
        );
      } catch (queueError) {
        // Log but do not rethrow: a failure to enqueue email should not abort
        // push delivery.  BullMQ will retry the notification job anyway, which
        // will attempt to re-enqueue the email.
        console.error(
          JSON.stringify({
            level: "error",
            service: "notificationWorker",
            jobId: job.id,
            notificationId,
            userId,
            tenantId,
            channel: "email",
            message: "Failed to enqueue email notification job",
            error: (queueError as Error).message,
            timestamp: new Date().toISOString(),
          }),
        );
        throw queueError;
      }
    }

    // ── 5. push channel ──
    //
    // Delegates to WebPushService when available.  If the service is not yet
    // implemented the channel is skipped gracefully (Req 10.2).

    if (pushEnabled) {
      const webPushService = await loadWebPushService();

      if (webPushService === null) {
        // Service not yet available — skip silently with a warning log.
        console.warn(
          JSON.stringify({
            level: "warn",
            service: "notificationWorker",
            jobId: job.id,
            notificationId,
            userId,
            tenantId,
            channel: "push",
            message:
              "WebPushService not available — push channel skipped gracefully",
            timestamp: new Date().toISOString(),
          }),
        );
      } else {
        try {
          await webPushService.sendToUser(userId, {
            notificationId,
            type,
            title: notification?.title ?? "",
            body: notification?.body ?? "",
            resourceType: notification?.resourceType ?? null,
            resourceId: notification?.resourceId ?? null,
            tenantId,
          });
        } catch (pushError) {
          // Push failures are logged but do not fail the entire job — in-app
          // and email delivery should still count as successful.  If push is
          // consistently failing, the monitoring layer will surface the errors.
          console.error(
            JSON.stringify({
              level: "error",
              service: "notificationWorker",
              jobId: job.id,
              notificationId,
              userId,
              tenantId,
              channel: "push",
              message: "Push notification delivery failed",
              error: (pushError as Error).message,
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
    }
  },
  {
    connection: redisConnection as any,
    concurrency: 10,
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Error handling
//
// Log structured JSON on job failure (after all BullMQ retries are exhausted)
// so that monitoring / alerting can surface persistent notification failures.
// ─────────────────────────────────────────────────────────────────────────────

notificationWorker.on(
  "failed",
  (job: Job<NotificationJob> | undefined, error: Error) => {
    console.error(
      JSON.stringify({
        level: "error",
        service: "notificationWorker",
        jobId: job?.id ?? "unknown",
        notificationId: job?.data?.notificationId ?? "unknown",
        userId: job?.data?.userId ?? "unknown",
        tenantId: job?.data?.tenantId ?? "unknown",
        type: job?.data?.type ?? "unknown",
        channels: job?.data?.channels ?? [],
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }),
    );
  },
);
