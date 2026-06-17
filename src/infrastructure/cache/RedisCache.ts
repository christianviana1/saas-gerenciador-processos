/**
 * RedisCache — Generic Redis cache utility
 *
 * Provides a simple, fail-silent cache layer backed by Redis (IORedis).
 * All methods catch and suppress errors so a Redis outage never breaks
 * the application — the caller will simply receive `null` on a miss or
 * a no-op on a write failure.
 *
 * Task 23.3 — Cache de sessão e configuração de Tenant
 * Requirements: 18.5 (cache optimization to reduce DB lookups)
 */

import IORedis from 'ioredis';

// ─────────────────────────────────────────────────────────────────
// Redis Client
// ─────────────────────────────────────────────────────────────────

/**
 * Dedicated Redis client for the cache layer.
 *
 * A separate client (rather than reusing the BullMQ connection) avoids
 * interference with BullMQ's `maxRetriesPerRequest: null` requirement.
 */
const createRedisClient = (): IORedis => {
  const client = new IORedis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD ?? undefined,
    // Reconnection with exponential back-off (max 3 s)
    retryStrategy: (times) => Math.min(times * 100, 3_000),
    // Don't queue commands while offline — fail fast and open
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  client.on('error', (err: Error) => {
    // Fail-silent: log but never surface cache errors to callers
    console.error('[RedisCache] Redis connection error:', err.message);
  });

  return client;
};

// ─────────────────────────────────────────────────────────────────
// RedisCache Class
// ─────────────────────────────────────────────────────────────────

export class RedisCache {
  private readonly redis: IORedis;

  constructor(redis?: IORedis) {
    this.redis = redis ?? createRedisClient();
  }

  /**
   * Retrieve a cached value by key.
   *
   * @param key - Cache key
   * @returns The deserialized value, or `null` on cache miss or error
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      // Fail-silent — treat any error as a cache miss
      return null;
    }
  }

  /**
   * Store a value in the cache with an explicit TTL.
   *
   * @param key        - Cache key
   * @param value      - Value to cache (will be JSON-serialized)
   * @param ttlSeconds - Time-to-live in seconds
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      await this.redis.set(key, serialized, 'EX', ttlSeconds);
    } catch {
      // Fail-silent — a write failure simply means the cache won't be warm
    }
  }

  /**
   * Delete a single key from the cache.
   *
   * @param key - Cache key to remove
   */
  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // Fail-silent
    }
  }

  /**
   * Delete all keys matching a glob pattern.
   *
   * Uses Redis `SCAN` (cursor-based) to avoid blocking the server with KEYS.
   * Operates in batches of 100. Fail-silent on any error.
   *
   * @param pattern - Redis glob pattern, e.g. `"tenant:*"`
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';

      do {
        // SCAN returns [nextCursor, keys[]]
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );

        cursor = nextCursor;

        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch {
      // Fail-silent — pattern invalidation is best-effort
    }
  }

  /**
   * Close the underlying Redis connection.
   * Useful for graceful shutdown and test teardown.
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

// ─────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────

/**
 * Application-wide singleton cache instance.
 * Import and use this everywhere instead of constructing a new instance.
 */
export const redisCache = new RedisCache();
