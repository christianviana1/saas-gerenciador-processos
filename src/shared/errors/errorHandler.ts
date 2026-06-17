/**
 * Global error handlers for API Routes and Server Actions.
 *
 * Both handlers normalise any thrown value into the standard error envelope:
 *
 * ```json
 * {
 *   "code":      "VALIDATION_ERROR",
 *   "message":   "CNJ number is invalid",
 *   "details":   { "field": "cnjNumber" },
 *   "requestId": "req-abc123"
 * }
 * ```
 *
 * Requirements: 1.3, 2.3
 */

import { AppError } from './AppError';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** The normalised JSON error envelope returned to callers. */
export interface ErrorResponse {
  /** Machine-readable error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Optional structured details (e.g. per-field validation failures) */
  details?: Record<string, unknown>;
  /** Request ID for distributed tracing — may be undefined in Server Actions */
  requestId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts any thrown value to an `ErrorResponse` + HTTP status code pair.
 *
 * - Known `AppError` subclasses preserve their `code` and `statusCode`.
 * - Everything else becomes a 500 INTERNAL_SERVER_ERROR.
 */
function toErrorResponse(
  error: unknown,
  requestId?: string,
): { response: ErrorResponse; statusCode: number } {
  if (error instanceof AppError) {
    const response: ErrorResponse = {
      code: error.code,
      message: error.message,
    };

    if (error.details !== undefined) {
      response.details = error.details;
    }

    const resolvedRequestId = requestId ?? error.requestId;
    if (resolvedRequestId !== undefined) {
      response.requestId = resolvedRequestId;
    }

    return { response, statusCode: error.statusCode };
  }

  // Unknown / unexpected errors — never expose internal details
  const response: ErrorResponse = {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred. Please try again later.',
  };

  if (requestId !== undefined) {
    response.requestId = requestId;
  }

  return { response, statusCode: 500 };
}

// ─────────────────────────────────────────────────────────────────────────────
// API Route handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps any error thrown inside an API Route handler into a `Response` with
 * the appropriate HTTP status code and JSON body.
 *
 * @param error     The caught error (can be any value).
 * @param requestId Optional request ID for distributed tracing.
 *
 * @example
 * // Inside a Next.js Route Handler:
 * export async function GET(req: Request) {
 *   try {
 *     const data = await fetchSomething();
 *     return Response.json(data);
 *   } catch (err) {
 *     return handleApiError(err, req.headers.get('x-request-id') ?? undefined);
 *   }
 * }
 */
export function handleApiError(error: unknown, requestId?: string): Response {
  const { response, statusCode } = toErrorResponse(error, requestId);

  return new Response(JSON.stringify(response), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Action handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps any error thrown inside a Server Action into a plain object that React
 * (and client-side code) can safely consume.
 *
 * Server Actions cannot return `Response` objects, so this function returns a
 * discriminated-union style `{ error: ErrorResponse }` which callers can check.
 *
 * @param error The caught error (can be any value).
 *
 * @example
 * // Inside a Server Action:
 * export async function createProcessAction(data: unknown) {
 *   try {
 *     return await createProcess(data);
 *   } catch (err) {
 *     return handleServerActionError(err);
 *   }
 * }
 */
export function handleServerActionError(
  error: unknown,
): { error: ErrorResponse } {
  const { response } = toErrorResponse(error);
  return { error: response };
}
