/**
 * Tenant — Domain entity for a law firm tenant.
 *
 * Mirrors the Prisma `Tenant` model as a plain TypeScript type with
 * business-level validation helpers. Every piece of data on the platform
 * belongs to a Tenant identified by an immutable `id`.
 *
 * Requirements: 1.1, 1.4, 1.5, 1.6, 17.2
 */

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export type TenantPlan = 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
export type TenantStatus = 'ACTIVE' | 'BLOCKED' | 'SUSPENDED' | 'TERMINATED';

// ─────────────────────────────────────────────────────────────────────────────
// Entity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Domain representation of a Tenant (law firm account).
 * Field names mirror the Prisma schema (camelCase).
 */
export interface Tenant {
  id: string;
  name: string;
  /** URL-safe unique identifier for the tenant (e.g. "costa-advogados") */
  slug: string;
  plan: TenantPlan;
  status: TenantStatus;
  /** Free-form JSON settings for feature flags and per-tenant configuration */
  settings: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data transfer objects for create / update
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateTenantData {
  name: string;
  slug: string;
  plan?: TenantPlan;
  settings?: Record<string, unknown>;
}

export interface UpdateTenantData {
  name?: string;
  plan?: TenantPlan;
  status?: TenantStatus;
  settings?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Business validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Slug must be 3–100 chars, lowercase letters, digits and hyphens only. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$|^[a-z0-9]{1,100}$/;

/**
 * Returns `true` when the slug satisfies platform naming rules.
 * A valid slug:
 *  - Is 1–100 characters long
 *  - Contains only lowercase letters, digits, and hyphens
 *  - Does not start or end with a hyphen
 */
export function isValidTenantSlug(slug: string): boolean {
  if (typeof slug !== 'string') return false;
  return SLUG_PATTERN.test(slug.trim());
}

/**
 * Returns `true` when the tenant may accept new logins.
 * Blocked, suspended, and terminated tenants must not allow access.
 *
 * Requirement 1.5
 */
export function isTenantActive(tenant: Pick<Tenant, 'status'>): boolean {
  return tenant.status === 'ACTIVE';
}
