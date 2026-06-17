/**
 * WebPushService
 *
 * Encapsulates Web Push notification delivery using the `web-push` library
 * with VAPID authentication. Subscriptions are stored in Redis keyed by
 * userId so no database migration is required.
 *
 * Environment variables required:
 *   VAPID_PUBLIC_KEY   — URL-safe base64 VAPID public key
 *   VAPID_PRIVATE_KEY  — URL-safe base64 VAPID private key
 *   VAPID_SUBJECT      — mailto: or https: URI identifying the push sender
 *
 * Requirements: 11.4, 10.9
 */

import webPush, {
  type PushSubscription as WebPushSubscription,
} from "web-push";
import IORedis from "ioredis";

// ─────────────────────────────────────────────────────────────────────────────
// Redis client (singleton — reused across invocations)
// ─────────────────────────────────────────────────────────────────────────────

const redis = new IORedis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// VAPID configuration
// ─────────────────────────────────────────────────────────────────────────────

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? "";
const vapidSubject = process.env.VAPID_SUBJECT ?? "mailto:admin@legalsaas.app";

if (vapidPublicKey && vapidPrivateKey) {
  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis key helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the Redis key under which all push subscriptions for a user are
 * stored as a JSON-serialised list.
 *
 * Format: push:subscriptions:{userId}
 */
function subscriptionKey(userId: string): string {
  return `push:subscriptions:${userId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Push notification payload
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of the JSON payload sent inside each Push notification. */
export interface PushPayload {
  title: string;
  body: string;
  /** URL the browser should navigate to when the notification is clicked. */
  url?: string;
  /** Arbitrary extra data forwarded to the service worker. */
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// WebPushService
// ─────────────────────────────────────────────────────────────────────────────

export class WebPushService {
  /**
   * Persists a push subscription in Redis for the given user.
   *
   * Multiple subscriptions per user are supported (e.g. browser + mobile).
   * The subscription list is capped at 10 entries per user to prevent
   * unbounded growth — the oldest entry is evicted when the limit is exceeded.
   *
   * @param userId       Platform user ID
   * @param subscription Raw `PushSubscription` JSON from the browser
   */
  async saveSubscription(
    userId: string,
    subscription: PushSubscriptionJSON,
  ): Promise<void> {
    const key = subscriptionKey(userId);

    // Fetch existing subscriptions and skip duplicates (same endpoint)
    const existing = await this.getSubscriptions(userId);
    const isDuplicate = existing.some(
      (s) => s.endpoint === subscription.endpoint,
    );
    if (isDuplicate) return;

    // Serialise and push the new subscription to a Redis list
    await redis.lpush(key, JSON.stringify(subscription));

    // Cap the list at 10 subscriptions per user (evict oldest)
    await redis.ltrim(key, 0, 9);

    // TTL: 60 days — subscriptions that haven't been refreshed are likely stale
    await redis.expire(key, 60 * 24 * 60 * 60);
  }

  /**
   * Retrieves all stored push subscriptions for a user.
   *
   * @param userId  Platform user ID
   */
  async getSubscriptions(userId: string): Promise<PushSubscriptionJSON[]> {
    const key = subscriptionKey(userId);
    const raw = await redis.lrange(key, 0, -1);

    return raw
      .map((item) => {
        try {
          return JSON.parse(item) as PushSubscriptionJSON;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as PushSubscriptionJSON[];
  }

  /**
   * Removes a specific push subscription for a user.
   * Called when the push service returns HTTP 410 (subscription expired/unsubscribed).
   *
   * @param userId    Platform user ID
   * @param endpoint  The `endpoint` field of the subscription to remove
   */
  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    const key = subscriptionKey(userId);
    const subscriptions = await this.getSubscriptions(userId);

    for (const sub of subscriptions) {
      if (sub.endpoint === endpoint) {
        await redis.lrem(key, 0, JSON.stringify(sub));
      }
    }
  }

  /**
   * Sends a push notification to a single `PushSubscriptionJSON`.
   *
   * @param subscription  Browser push subscription object
   * @param payload       Notification data to send
   */
  async sendNotification(
    subscription: PushSubscriptionJSON,
    payload: PushPayload,
  ): Promise<void> {
    if (!vapidPublicKey || !vapidPrivateKey) {
      console.warn(
        JSON.stringify({
          level: "warn",
          service: "WebPushService",
          message: "VAPID keys not configured — push notification skipped",
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    // web-push expects keys as { p256dh, auth } strings
    const webPushSub: WebPushSubscription = {
      endpoint: subscription.endpoint ?? "",
      keys: {
        p256dh: (subscription.keys as Record<string, string>)?.p256dh ?? "",
        auth: (subscription.keys as Record<string, string>)?.auth ?? "",
      },
    };

    await webPush.sendNotification(webPushSub, JSON.stringify(payload));
  }

  /**
   * Sends a push notification to **all** registered subscriptions for a user.
   *
   * Stale subscriptions (HTTP 404 / 410 from the push service) are automatically
   * removed from Redis so they don't accumulate over time.
   *
   * @param userId   Platform user ID
   * @param payload  Notification data to send
   */
  async sendToUser(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const subscriptions = await this.getSubscriptions(userId);

    if (subscriptions.length === 0) {
      console.info(
        JSON.stringify({
          level: "info",
          service: "WebPushService",
          userId,
          message: "No push subscriptions found for user — skipping delivery",
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    // Build the payload forwarded to the service worker.
    // `url` is derived from resourceType + resourceId when available so the
    // notificationclick handler can navigate directly to the related resource.
    const resourceUrl = buildResourceUrl(
      payload.resourceType as string | null,
      payload.resourceId as string | null,
    );

    const pushPayload: PushPayload = {
      title: String(payload.title ?? "LegalSaaS"),
      body: String(payload.body ?? ""),
      url: resourceUrl,
      notificationId: payload.notificationId,
      type: payload.type,
      tenantId: payload.tenantId,
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
    };

    // Send to all subscriptions in parallel; handle individual failures
    const results = await Promise.allSettled(
      subscriptions.map((sub) => this.sendNotification(sub, pushPayload)),
    );

    // Remove stale subscriptions (push service returned 404 / 410)
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        const err = result.reason as { statusCode?: number; endpoint?: string };
        const isGone = err?.statusCode === 404 || err?.statusCode === 410;
        const endpoint = subscriptions[i].endpoint;

        if (isGone && endpoint) {
          await this.removeSubscription(userId, endpoint);
          console.info(
            JSON.stringify({
              level: "info",
              service: "WebPushService",
              userId,
              endpoint,
              message: `Removed stale push subscription (HTTP ${err.statusCode})`,
              timestamp: new Date().toISOString(),
            }),
          );
        } else {
          console.error(
            JSON.stringify({
              level: "error",
              service: "WebPushService",
              userId,
              message: "Failed to deliver push notification",
              error: String(err),
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a notification's `resourceType` + `resourceId` pair to a navigable
 * URL within the platform, used by the `notificationclick` handler in sw.js.
 */
function buildResourceUrl(
  resourceType: string | null | undefined,
  resourceId: string | null | undefined,
): string {
  if (!resourceType || !resourceId) return "/";

  switch (resourceType.toLowerCase()) {
    case "process":
    case "processo":
      return `/processos/${resourceId}`;
    case "task":
    case "tarefa":
      return `/tarefas/${resourceId}`;
    default:
      return "/";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

/** Singleton instance used across the application and in `notificationWorker`. */
export const webPushService = new WebPushService();
