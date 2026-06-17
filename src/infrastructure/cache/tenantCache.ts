/**
 * tenantCache — Tenant configuration cache helpers
 *
 * Wraps the generic `RedisCache` with tenant-specific key conventions
 * and a 5-minute TTL to reduce database round-trips on every authenticated
 * request that needs the tenant configuration.
 *
 * Key format: `tenant:config:<tenantId>`
 *
 * Task 23.3 — Cache de sessão e configuração de Tenant
 * Requirements: 18.5 (cache optimization)
 */

import { redisCache } from './RedisCache';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * Subset of tenant data cached per request to avoid repeated DB hits.
 * Mirrors the fields most commonly needed by middleware / guards.
 */
export interface TenantConfig {
  /** Primary key (CUID) */
  id: string;
  /** Human-readable name of the law firm */
  name: string;
  /** URL-safe unique slug */
  slug: string;
  /** Subscription plan */
  plan: 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
  /** Tenant account status */
  status: 'ACTIVE' | 'BLOCKED' | 'SUSPENDED' | 'TERMINATED';
  /** Free-form per-tenant feature flags and settings */
  settings: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

/** Default TTL: 5 minutes (300 seconds) — Requirement 18.5 */
const DEFAULT_TTL_SECONDS = 300;

/** Key namespace for tenant config cache entries */
const TENANT_CONFIG_PREFIX = 'tenant:config:';

// ─────────────────────────────────────────────────────────────────
// Key builder
// ─────────────────────────────────────────────────────────────────

function buildTenantConfigKey(tenantId: string): string {
  return `${TENANT_CONFIG_PREFIX}${tenantId}`;
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Retrieve a tenant's configuration from the cache.
 *
 * @param tenantId - The tenant's primary key
 * @returns The cached `TenantConfig`, or `null` on cache miss / error
 */
export async function getTenantConfig(tenantId: string): Promise<TenantConfig | null> {
  const key = buildTenantConfigKey(tenantId);
  return redisCache.get<TenantConfig>(key);
}

/**
 * Store a tenant's configuration in the cache.
 *
 * @param tenantId   - The tenant's primary key
 * @param config     - The `TenantConfig` object to cache
 * @param ttlSeconds - Optional TTL override (default: 300 s / 5 min)
 */
export async function setTenantConfig(
  tenantId: string,
  config: TenantConfig,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const key = buildTenantConfigKey(tenantId);
  await redisCache.set<TenantConfig>(key, config, ttlSeconds);
}

/**
 * Invalidate (delete) the cached configuration for a specific tenant.
 *
 * Call this whenever the tenant record is updated (plan change, status
 * change, settings update) so the next request fetches fresh data from
 * the database.
 *
 * @param tenantId - The tenant's primary key
 */
export async function invalidateTenantConfig(tenantId: string): Promise<void> {
  const key = buildTenantConfigKey(tenantId);
  await redisCache.del(key);
}
