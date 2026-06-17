/**
 * CnjNumber — Value Object for the Brazilian CNJ process number.
 *
 * Format: NNNNNNN-DD.AAAA.J.TT.OOOO
 *   - NNNNNNN : 7-digit sequential process number
 *   - DD      : 2-digit check digits
 *   - AAAA    : 4-digit year
 *   - J       : 1-digit justice segment (1–9)
 *   - TT      : 2-digit court/tribunal code
 *   - OOOO    : 4-digit origin (court of origin)
 *
 * Requirements: 6.1, 16.2
 */

import { ValidationError } from '@/shared/errors/ValidationError';

/**
 * Regex that matches the exact CNJ number pattern.
 *
 * Breaking it down:
 *   ^           start of string
 *   \d{7}       7-digit process number   (NNNNNNN)
 *   -           literal hyphen
 *   \d{2}       2-digit check digits     (DD)
 *   \.          literal dot
 *   \d{4}       4-digit year             (AAAA)
 *   \.          literal dot
 *   \d{1}       1-digit justice segment  (J)
 *   \.          literal dot
 *   \d{2}       2-digit tribunal code    (TT)
 *   \.          literal dot
 *   \d{4}       4-digit origin           (OOOO)
 *   $           end of string
 */
const CNJ_PATTERN = /^\d{7}-\d{2}\.\d{4}\.\d{1}\.\d{2}\.\d{4}$/;

/**
 * Immutable value object that wraps a validated CNJ number string.
 *
 * Usage:
 *   const cnj = CnjNumber.parse('0001234-56.2023.8.26.0100');
 *   console.log(cnj.value); // '0001234-56.2023.8.26.0100'
 *   console.log(cnj.toString()); // '0001234-56.2023.8.26.0100'
 */
export class CnjNumber {
  /** The raw, validated CNJ number string. */
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /**
   * Parse and validate a raw string as a CNJ number.
   *
   * @param raw - The raw input string to validate.
   * @returns A new `CnjNumber` instance if the format is valid.
   * @throws {ValidationError} When the string does not match the
   *         expected pattern `NNNNNNN-DD.AAAA.J.TT.OOOO`.
   */
  static parse(raw: string): CnjNumber {
    if (typeof raw !== 'string') {
      throw new ValidationError(
        `CNJ number must be a string, received ${typeof raw}.`,
        { errorCode: 'CNJ_INVALID_TYPE' },
      );
    }

    const trimmed = raw.trim();

    if (!CNJ_PATTERN.test(trimmed)) {
      throw new ValidationError(
        `Invalid CNJ number format: "${trimmed}". ` +
          'Expected pattern: NNNNNNN-DD.AAAA.J.TT.OOOO ' +
          '(e.g. "0001234-56.2023.8.26.0100").',
        { errorCode: 'CNJ_INVALID_FORMAT', cnjNumber: trimmed },
      );
    }

    return new CnjNumber(trimmed);
  }

  /**
   * Returns `true` if the given string matches the CNJ format,
   * without throwing. Useful for quick guards before `parse()`.
   */
  static isValid(raw: string): boolean {
    if (typeof raw !== 'string') return false;
    return CNJ_PATTERN.test(raw.trim());
  }

  /** Returns the raw CNJ string. */
  toString(): string {
    return this.value;
  }

  /** Value-equality comparison. */
  equals(other: CnjNumber): boolean {
    return this.value === other.value;
  }
}
