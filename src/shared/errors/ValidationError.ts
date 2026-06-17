/**
 * Re-export `ValidationError` from the canonical location.
 *
 * This file is kept for backward compatibility so that existing imports of
 * `@/shared/errors/ValidationError` continue to resolve without changes.
 *
 * The full error hierarchy (including `ValidationError`) now lives in:
 *   `src/shared/errors/AppError.ts`
 *
 * Requirements: 6.1, 1.3
 */
export { ValidationError } from './AppError';
