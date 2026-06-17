import { createHash } from 'crypto';

/**
 * Domain service responsible for detecting changes in DataJud payloads
 * via SHA-256 hash comparison.
 *
 * Requirement 7.3: The Hash_Detector SHALL calculate a SHA-256 hash of the payload
 * returned by DataJud for each process and compare it with the stored `datajud_hash`
 * to identify changes before updating the database.
 */
export class HashDetector {
  /**
   * Computes a deterministic SHA-256 hash of the given payload.
   *
   * Serializes the payload using JSON.stringify with sorted keys to ensure
   * consistent hashing regardless of property insertion order.
   *
   * @param payload - The object to hash (e.g. a DataJud API response payload).
   * @returns A 64-character lowercase hex string representing the SHA-256 hash.
   */
  computeHash(payload: object): string {
    const sorted = JSON.stringify(payload, Object.keys(payload).sort());
    return createHash('sha256').update(sorted, 'utf8').digest('hex');
  }

  /**
   * Determines whether the given payload differs from a previously computed hash.
   *
   * @param previousHash - The SHA-256 hash stored from the previous sync.
   * @param payload - The current payload to compare against.
   * @returns `true` if the payload has changed (hashes differ), `false` otherwise.
   */
  hasChanged(previousHash: string, payload: object): boolean {
    return this.computeHash(payload) !== previousHash;
  }
}

/** Singleton instance for convenient use across the application. */
export const hashDetector = new HashDetector();
