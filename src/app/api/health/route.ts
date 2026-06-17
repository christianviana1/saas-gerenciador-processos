/**
 * API Route: GET /api/health
 *
 * Returns the health status of all critical platform dependencies:
 * - database: Prisma connectivity check via `SELECT 1`
 * - redis: IORedis PING command
 * - email: SMTP_HOST environment variable presence check
 * - bullmq: Waiting job counts for all queues
 *
 * Always returns HTTP 200 (even when degraded) so load balancers
 * do not remove the instance from rotation.
 *
 * Never exposes connection strings, credentials, or internal error details.
 *
 * Requirements: 14.4
 */

import { prisma } from '@/infrastructure/database/prisma/client';
import {
  datajudSyncQueue,
  notificationsQueue,
  auditQueue,
  redisConnection,
} from '@/infrastructure/queues/queues';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DatabaseStatus {
  status: 'ok' | 'error';
}

interface RedisStatus {
  status: 'ok' | 'error';
}

interface EmailStatus {
  status: 'ok' | 'unconfigured';
}

interface BullMQQueues {
  'audit': number;
  'notifications': number;
  'datajud-sync': number;
}

interface BullMQStatus {
  status: 'ok' | 'error';
  queues?: BullMQQueues;
}

interface HealthDependencies {
  database: DatabaseStatus;
  redis: RedisStatus;
  email: EmailStatus;
  bullmq: BullMQStatus;
}

interface HealthResponse {
  status: 'healthy' | 'degraded';
  timestamp: string;
  dependencies: HealthDependencies;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency checks (each with a 3-second timeout)
// ─────────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 3_000;

/**
 * Wraps a promise with a timeout. Rejects after `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms),
    ),
  ]);
}

async function checkDatabase(): Promise<DatabaseStatus> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, TIMEOUT_MS);
    return { status: 'ok' };
  } catch {
    return { status: 'error' };
  }
}

async function checkRedis(): Promise<RedisStatus> {
  try {
    const result = await withTimeout(redisConnection.ping(), TIMEOUT_MS);
    return result === 'PONG' ? { status: 'ok' } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

function checkEmail(): EmailStatus {
  const smtpHost = process.env.SMTP_HOST;
  return { status: smtpHost ? 'ok' : 'unconfigured' };
}

async function checkBullMQ(): Promise<BullMQStatus> {
  try {
    const [auditWaiting, notificationsWaiting, datajudWaiting] =
      await withTimeout(
        Promise.all([
          auditQueue.getWaitingCount(),
          notificationsQueue.getWaitingCount(),
          datajudSyncQueue.getWaitingCount(),
        ]),
        TIMEOUT_MS,
      );

    return {
      status: 'ok',
      queues: {
        audit: auditWaiting,
        notifications: notificationsWaiting,
        'datajud-sync': datajudWaiting,
      },
    };
  } catch {
    return { status: 'error' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/health
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  const [database, redis, bullmq] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkBullMQ(),
  ]);

  const email = checkEmail();

  const isHealthy =
    database.status === 'ok' &&
    redis.status === 'ok' &&
    bullmq.status === 'ok';

  const body: HealthResponse = {
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    dependencies: {
      database,
      redis,
      email,
      bullmq,
    },
  };

  // Always return 200 — load balancers should not remove the instance
  // based on dependency degradation (only on process crashes).
  return Response.json(body, { status: 200 });
}
