/**
 * Public API for `src/shared/errors`.
 *
 * Re-exports the full error hierarchy and the global error handlers so that
 * consumers only need a single import path:
 *
 * ```ts
 * import { ValidationError, handleApiError } from '@/shared/errors';
 * ```
 */

export {
  AppError,
  ValidationError,
  AuthenticationError,
  ForbiddenError,
  TenantIsolationError,
  NotFoundError,
  ConflictError,
} from './AppError';

export type { ErrorResponse } from './errorHandler';
export { handleApiError, handleServerActionError } from './errorHandler';
