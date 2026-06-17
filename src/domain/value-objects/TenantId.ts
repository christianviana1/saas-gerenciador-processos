/**
 * TenantId — Value Object for a tenant's unique identifier.
 *
 * Encapsulates a non-empty string that identifies a Tenant within the
 * multi-tenant platform. Enforces:
 *   - Must be a non-empty string
 *   - Trimmed value must remain non-empty
 *   - No leading/trailing whitespace is preserved
 *
 * The identifier format (e.g. cuid, uuid) is set by the database layer
 * and is not re-validated here — this value object only guarantees
 * structural non-emptiness, ensuring a tenant_id is never blank.
 *
 * Requirements: 1.1
 */

import { ValidationError } from '@/shared/errors/ValidationError';

/**
 * Immutable value object that wraps a validated tenant identifier string.
 *
 * Usage:
 *   const id = TenantId.parse('clx0abc123');
 *   console.log(id.value);      // 'clx0abc123'
 *   console.log(id.toString()); // 'clx0abc123'
 *
 *   TenantId.parse('');   // throws ValidationError
 *   TenantId.parse('  '); // throws ValidationError
 */
export class TenantId {
  /** The validated, trimmed tenant identifier string. */
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  // ─────────────────────────────────────────────────────────────────
  // Static factories
  // ─────────────────────────────────────────────────────────────────

  /**
   * Parse and validate a raw string as a TenantId.
   *
   * @param raw - The raw input value to validate.
   * @returns A new immutable `TenantId` instance containing the trimmed value.
   * @throws {ValidationError} When the value is not a string or is blank after trimming.
   */
  static parse(raw: unknown): TenantId {
    if (typeof raw !== 'string') {
      throw new ValidationError(
        `TenantId must be a string, received ${typeof raw}.`,
        { errorCode: 'TENANT_ID_INVALID_TYPE' },
      );
    }

    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      throw new ValidationError(
        'TenantId must be a non-empty string.',
        { errorCode: 'TENANT_ID_EMPTY' },
      );
    }

    return new TenantId(trimmed);
  }

  /**
   * Returns `true` if the given value can be used as a valid TenantId,
   * without throwing. Useful for lightweight guards.
   */
  static isValid(raw: unknown): boolean {
    if (typeof raw !== 'string') return false;
    return raw.trim().length > 0;
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * Returns the raw tenant identifier string.
   * Useful when passing to Prisma queries as a plain string.
   */
  toString(): string {
    return this.value;
  }

  /** Value-equality comparison. */
  equals(other: TenantId): boolean {
    return this.value === other.value;
  }
}
