/**
 * Tenant Guard Middleware
 *
 * Extracts `tenantId` from the Auth.js session JWT, compares it against the
 * resource's `tenantId`, and enforces cross-tenant isolation (Requirement 1.3).
 *
 * On a mismatch the guard returns HTTP 403 and fires a fire-and-forget audit
 * event via `auditQueue` (BullMQ).
 *
 * Exports:
 *  - `getSessionTenantId(request)` — helper that returns the tenantId from the
 *    JWT session, or null if the token is missing/invalid.
 *  - `tenantGuard(request, resourceTenantId)` — returns `null` when access is
 *    allowed; returns a 403 `Response` when a cross-tenant attempt is detected.
 *
 * Requirements: 1.2, 1.3
 */

import { type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { auditQueue } from '@/infrastructure/queues/queues';
import { TenantIsolationError } from '@/shared/errors/AppError';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape of the JWT token as emitted by the Auth.js credentials provider.
 * The provider stores `userId`, `tenantId`, and `role` in the token payload.
 */
interface SessionToken {
  sub?: string;
  userId?: string;
  tenantId?: string;
  role?: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts metadata from the request for audit purposes.
 * Never throws — returns empty strings on failure.
 */
function extractRequestMeta(request: NextRequest): {
  ipAddress: string;
  userAgent: string;
} {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    '0.0.0.0';

  const userAgent = request.headers.get('user-agent') ?? 'unknown';

  return { ipAddress: ip, userAgent };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the Auth.js JWT from the incoming request and returns the `tenantId`
 * embedded in the token.
 *
 * @returns The `tenantId` string if a valid, signed token is present; `null`
 *          otherwise (unauthenticated request or token missing the claim).
 *
 * Requirement 1.2: validate tenantId of session before returning any data.
 */
export async function getSessionTenantId(
  request: NextRequest,
): Promise<string | null> {
  const secret = process.env.NEXTAUTH_SECRET;

  if (!secret) {
    // Misconfiguration — treat as unauthenticated to fail safely.
    return null;
  }

  const token = (await getToken({ req: request, secret })) as SessionToken | null;

  if (!token) {
    return null;
  }

  // Auth.js v5 beta stores custom claims directly on the token.
  // The credentials provider must set `token.tenantId` during the `jwt` callback.
  const tenantId = token.tenantId ?? null;

  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    return null;
  }

  return tenantId;
}

/**
 * Tenant isolation guard.
 *
 * Compares the session's `tenantId` (from the JWT) with `resourceTenantId`
 * (the tenant that owns the resource being accessed).
 *
 * - If they match → returns `null` (access permitted).
 * - If they differ → fires an async audit event and returns a 403 Response.
 *   The `TenantIsolationError` is included in the JSON body for structured
 *   error handling by clients.
 *
 * SUPER_ADMIN bypass: if the JWT carries `role === 'SUPER_ADMIN'`, access is
 * always allowed regardless of tenant. This mirrors the cross-tenant policy in
 * `RBACEngine`.
 *
 * @param request          The incoming Next.js request.
 * @param resourceTenantId The `tenant_id` of the resource being accessed.
 * @returns `null` when access is granted; a `Response` with status 403 when
 *          denied.
 *
 * Requirements: 1.2, 1.3
 */
export async function tenantGuard(
  request: NextRequest,
  resourceTenantId: string,
): Promise<Response | null> {
  const secret = process.env.NEXTAUTH_SECRET;

  // If NEXTAUTH_SECRET is not configured, deny all access defensively.
  if (!secret) {
    const error = new TenantIsolationError('Server misconfiguration: NEXTAUTH_SECRET is not set');
    return buildForbiddenResponse(error);
  }

  const token = (await getToken({ req: request, secret })) as SessionToken | null;

  // No valid session — caller should handle 401 upstream; here we block.
  if (!token) {
    const error = new TenantIsolationError('No valid session token present');
    return buildForbiddenResponse(error);
  }

  const sessionTenantId = token.tenantId;
  const role = token.role;
  const userId = token.userId ?? token.sub ?? null;

  // SUPER_ADMIN may access resources across all tenants.
  if (role === 'SUPER_ADMIN') {
    return null;
  }

  // Validate that the session contains a usable tenantId claim.
  if (typeof sessionTenantId !== 'string' || sessionTenantId.trim() === '') {
    const error = new TenantIsolationError(
      'Session token is missing a valid tenantId claim',
    );

    void fireAuditEvent({
      tenantId: typeof resourceTenantId === 'string' ? resourceTenantId : null,
      userId: typeof userId === 'string' ? userId : null,
      action: 'tenant_guard.missing_claim',
      resourceTenantId,
      sessionTenantId: null,
      request,
    });

    return buildForbiddenResponse(error);
  }

  // Cross-tenant access attempt — the core isolation check (Requirement 1.3).
  if (sessionTenantId !== resourceTenantId) {
    const error = new TenantIsolationError(
      `Cross-tenant access denied: session tenant "${sessionTenantId}" attempted to access resource of tenant "${resourceTenantId}"`,
      {
        sessionTenantId,
        resourceTenantId,
        userId: userId ?? undefined,
      },
    );

    // Fire-and-forget: never block the response on audit persistence.
    void fireAuditEvent({
      tenantId: sessionTenantId,
      userId: typeof userId === 'string' ? userId : null,
      action: 'tenant_guard.cross_tenant_access',
      resourceTenantId,
      sessionTenantId,
      request,
    });

    return buildForbiddenResponse(error);
  }

  // Tenants match — access granted.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a standardised 403 JSON Response from a `TenantIsolationError`.
 */
function buildForbiddenResponse(error: TenantIsolationError): Response {
  const body = JSON.stringify({
    code: error.code,
    message: error.message,
    details: error.details ?? null,
  });

  return new Response(body, {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Enqueues an audit event for a tenant guard decision.
 * Uses `void` at call-sites to enforce fire-and-forget semantics.
 * Errors from BullMQ are swallowed here — audit failures must not affect
 * the guard's control flow (the 403 has already been emitted).
 */
async function fireAuditEvent(params: {
  tenantId: string | null;
  userId: string | null;
  action: string;
  resourceTenantId: string;
  sessionTenantId: string | null;
  request: NextRequest;
}): Promise<void> {
  const { ipAddress, userAgent } = extractRequestMeta(params.request);

  try {
    await auditQueue.add('tenant-guard-event', {
      tenantId: params.tenantId,
      userId: params.userId,
      action: params.action,
      resourceType: 'tenant',
      resourceId: params.resourceTenantId,
      ipAddress,
      userAgent,
      payloadAfter: {
        sessionTenantId: params.sessionTenantId,
        resourceTenantId: params.resourceTenantId,
        url: params.request.url,
        method: params.request.method,
      },
    });
  } catch {
    // Audit queue failure must never propagate — log to stderr as a last resort.
    console.error(
      '[tenantGuard] Failed to enqueue audit event for action:',
      params.action,
    );
  }
}
