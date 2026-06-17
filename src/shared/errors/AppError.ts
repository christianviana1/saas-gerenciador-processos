/**
 * Error hierarchy for the Legal SaaS Platform.
 *
 * All application errors extend `AppError`, which carries a machine-readable
 * `code`, an HTTP `statusCode`, optional structured `details`, and an optional
 * `requestId` for request tracing.
 *
 * Requirements: 1.3, 2.3
 */

// ─────────────────────────────────────────────────────────────────────────────
// Base error
// ─────────────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  /** Machine-readable error code (e.g. "VALIDATION_ERROR") */
  readonly code: string;

  /** HTTP status code that should be returned for this error */
  readonly statusCode: number;

  /** Optional structured details (e.g. per-field validation failures) */
  readonly details?: Record<string, unknown>;

  /** Request ID for distributed tracing (populated by the error handler) */
  requestId?: string;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.requestId = requestId;

    // Restore prototype chain (required when extending built-in Error in TS)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 400 — Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when user-supplied input fails validation.
 *
 * @example
 * throw new ValidationError('CNJ number is invalid', { field: 'cnjNumber' });
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message, 'VALIDATION_ERROR', 400, details, requestId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 401 — Authentication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when a request is not authenticated (missing or invalid credentials).
 *
 * Requirement 5.9: invalid/expired JWT → HTTP 401
 */
export class AuthenticationError extends AppError {
  constructor(
    message: string = 'Authentication required',
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message, 'AUTHENTICATION_ERROR', 401, details, requestId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 403 — Forbidden
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when an authenticated user lacks permission to perform an action.
 *
 * Requirement 2.3: RBAC denial → HTTP 403 + audit event
 */
export class ForbiddenError extends AppError {
  constructor(
    message: string = 'Access denied',
    details?: Record<string, unknown>,
    requestId?: string,
    /** Allow subclasses to supply a more specific error code */
    code: string = 'FORBIDDEN',
  ) {
    super(message, code, 403, details, requestId);
  }
}

/**
 * Specialisation of `ForbiddenError` for cross-tenant data access attempts.
 *
 * Requirement 1.3: cross-tenant request → HTTP 403 + audit event
 */
export class TenantIsolationError extends ForbiddenError {
  constructor(
    message: string = "Tenant isolation violation: access to another tenant's resource is forbidden",
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message, details, requestId, 'TENANT_ISOLATION_VIOLATION');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 404 — Not Found
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when a requested resource does not exist (or is not visible to the
 * current tenant — to avoid leaking existence of other tenants' data).
 */
export class NotFoundError extends AppError {
  constructor(
    message: string = 'Resource not found',
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message, 'NOT_FOUND', 404, details, requestId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 409 — Conflict
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown when a resource already exists and cannot be created again.
 *
 * @example
 * throw new ConflictError('A process with this CNJ number already exists', { cnjNumber });
 */
export class ConflictError extends AppError {
  constructor(
    message: string = 'Resource already exists',
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message, 'CONFLICT', 409, details, requestId);
  }
}
