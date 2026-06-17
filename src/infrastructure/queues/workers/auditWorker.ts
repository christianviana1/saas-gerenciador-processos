/**
 * Audit Worker
 *
 * Consumes jobs from the `audit` BullMQ queue and persists immutable
 * AuditLog records to the database via Prisma.
 *
 * Design decisions:
 *  - Concurrency 20: audit jobs are lightweight DB inserts; high
 *    concurrency avoids queue backlog under peak load.
 *  - payloadHash: SHA-256 of the *entire* job payload with keys sorted
 *    deterministically so the hash is reproducible for integrity checks
 *    (Requirement 3.4 / Property 4 — Imutabilidade de Trilhas).
 *  - Fire-and-forget on the producer side; errors here are logged as
 *    structured JSON and BullMQ retries up to 3 times before the job
 *    is parked (removeOnFail: false on the queue definition ensures no
 *    audit evidence is ever silently discarded).
 *
 * Requirements: 3.2, 3.3, 3.4
 */

import crypto from "crypto";
import { Worker, type Job } from "bullmq";
import {
  auditQueue,
  redisConnection,
  type AuditJob,
} from "@/infrastructure/queues/queues";
import { prisma } from "@/infrastructure/database/prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a deterministic SHA-256 hash over the job payload.
 *
 * Keys are sorted before serialisation so that insertion order differences
 * in the object never produce a different hash for the same logical data.
 *
 * Requirement 3.4 — integrity verification anchor.
 */
function computePayloadHash(data: AuditJob): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(data, Object.keys(data).sort()))
    .digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────────────────────────

export const auditWorker = new Worker<AuditJob>(
  auditQueue.name,
  async (job: Job<AuditJob>) => {
    const data = job.data;

    const payloadHash = computePayloadHash(data);

    await prisma.auditLog.create({
      data: {
        tenantId: data.tenantId ?? null,
        userId: data.userId ?? null,
        action: data.action,
        resourceType: data.resourceType,
        resourceId: data.resourceId ?? null,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        payloadBefore: data.payloadBefore
          ? (data.payloadBefore as any)
          : undefined,
        payloadAfter: data.payloadAfter
          ? (data.payloadAfter as any)
          : undefined,
        payloadHash,
      },
    });
  },
  {
    connection: redisConnection as any,
    concurrency: 20,
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Error handling
// Log structured JSON on failure so that monitoring / alerting can pick up
// audit persistence errors without losing context about which event failed.
// BullMQ will automatically retry the job per the queue's backoff policy.
// ─────────────────────────────────────────────────────────────────────────────

auditWorker.on("failed", (job: Job<AuditJob> | undefined, error: Error) => {
  console.error(
    JSON.stringify({
      level: "error",
      service: "auditWorker",
      jobId: job?.id ?? "unknown",
      action: job?.data?.action ?? "unknown",
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }),
  );
});
