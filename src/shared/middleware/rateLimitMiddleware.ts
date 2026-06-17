/**
 * Rate Limit Middleware
 *
 * Integrates `RateLimiter` into API route handlers to apply rate limits across
 * all public and authenticated endpoints (Requirement 12.4).
 *
 * ⚠️  IMPORTANT — Runtime Constraint:
 * `RateLimiter` uses `ioredis`, which is **Node.js-only** and does NOT work in
 * the Edge Runtime. This module must be imported exclusively from API route
 * handlers (Node.js runtime). Do NOT import this from `middleware.ts`, which
 * runs on the Edge Runtime.
 *
 * Usage (in an API route handler):
 * ```ts
 * import { applyRateLimit } from '@/shared/middleware/rateLimitMiddleware';
 *
 * export async function POST(request: NextRequest) {
 *   const limited = await applyRateLimit(request, { userId: session.userId });
 *   if (limited) return limited; // 429 already serialised
 *   // … handler logic …
 * }
 * ```
 *
 * Limit strategy per endpoint type:
 *  - Login (`/api/auth/callback/credentials`): LOGIN_BY_EMAIL keyed by email
 *    from request body, falling back to IP when the body cannot be read.
 *  - Authenticated endpoints (userId provided): API_BY_USER keyed by userId.
 *  - Public endpoints: PUBLIC keyed by requester IP.
 *
 * Requirements: 12.4
 */

import { type NextRequest } from 'next/server';
import { rateLimiter, RATE_LIMITS } from '@/infrastructure/security/RateLimiter';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Pathname used by Auth.js credentials provider for login. */
const LOGIN_PATHNAME = '/api/auth/callback/credentials';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the requester's IP address from common proxy headers.
 * Falls back to `'0.0.0.0'` when no header is present.
 */
function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    '0.0.0.0'
  );
}

/**
 * Attempts to extract the `email` field from a JSON request body.
 * Returns `null` when the body is empty, non-JSON, or lacks an email field.
 *
 * Uses `request.clone()` so the original body remains consumable by the route
 * handler downstream.
 */
async function extractEmailFromBody(request: NextRequest): Promise<string | null> {
  try {
    const cloned = request.clone();
    const body = await cloned.json() as Record<string, unknown>;
    const email = body?.email;
    if (typeof email === 'string' && email.trim().length > 0) {
      return email.trim().toLowerCase();
    }
    return null;
  } catch {
    // Body was not JSON or was already consumed — not an error, just fall back.
    return null;
  }
}

/**
 * Builds the standardised 429 Too Many Requests response.
 */
function buildRateLimitResponse(): Response {
  return new Response(
    JSON.stringify({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests',
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options forwarded by the calling route handler.
 *
 * @property userId   - Authenticated user's ID (omit for public endpoints).
 * @property tenantId - Authenticated user's tenant ID (reserved for future
 *                      per-tenant aggregate limiting; not used in this version).
 */
export interface RateLimitOptions {
  userId?: string;
  tenantId?: string;
}

/**
 * Applies the appropriate rate limit for the incoming request.
 *
 * Call this at the top of every API route handler **before** executing any
 * business logic. When the limit is exceeded the function returns a ready-made
 * `Response` with status 429 that the caller should return immediately.
 * When the request is within the allowed limits, `null` is returned and
 * execution may proceed normally.
 *
 * Rate limit strategy:
 * 1. **Login endpoint** (`/api/auth/callback/credentials`):
 *    Uses `RATE_LIMITS.LOGIN_BY_EMAIL` keyed by the email from the request
 *    body. Falls back to IP when the email cannot be read.
 * 2. **Authenticated endpoints** (`options.userId` is set):
 *    Uses `RATE_LIMITS.API_BY_USER` keyed by `userId`.
 * 3. **Public endpoints** (no `userId`):
 *    Uses `RATE_LIMITS.PUBLIC` keyed by the requester's IP.
 *
 * ⚠️  Node.js runtime only — do NOT call from Edge Runtime (`middleware.ts`).
 *
 * @param request - The incoming Next.js request object.
 * @param options - Optional context with `userId` and/or `tenantId`.
 * @returns A `Response` with status 429 if the limit is exceeded; `null` if
 *          the request is allowed to proceed.
 *
 * Requirements: 12.4
 */
export async function applyRateLimit(
  request: NextRequest,
  options?: RateLimitOptions,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  // ── 1. Login endpoint ─────────────────────────────────────────────────────
  if (pathname === LOGIN_PATHNAME) {
    const email = await extractEmailFromBody(request);
    const identifier = email ?? getClientIp(request);

    const result = await rateLimiter.checkWithConfig(
      RATE_LIMITS.LOGIN_BY_EMAIL,
      identifier,
    );

    if (!result.allowed) {
      return buildRateLimitResponse();
    }

    return null;
  }

  // ── 2. Authenticated endpoint ─────────────────────────────────────────────
  if (options?.userId) {
    const result = await rateLimiter.checkWithConfig(
      RATE_LIMITS.API_BY_USER,
      options.userId,
    );

    if (!result.allowed) {
      return buildRateLimitResponse();
    }

    return null;
  }

  // ── 3. Public endpoint ────────────────────────────────────────────────────
  const ip = getClientIp(request);
  const result = await rateLimiter.checkWithConfig(RATE_LIMITS.PUBLIC, ip);

  if (!result.allowed) {
    return buildRateLimitResponse();
  }

  return null;
}
