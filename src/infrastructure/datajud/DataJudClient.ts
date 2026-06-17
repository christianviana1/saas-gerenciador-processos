import { AppError, ValidationError } from '@/shared/errors/AppError'
import { validateExternalUrl, isSsrfTarget } from '@/shared/utils/ssrfValidator'
import {
  DataJudProcessSchema,
  type DataJudProcessResponse,
} from './schemas/datajudResponse.schema'

// ─────────────────────────────────────────────────────────────────────────────
// SSRF Protection — delegated to shared ssrfValidator utility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The DataJud client uses a hardcoded base URL — no user-supplied URLs are
 * ever passed to fetch(). The SSRF validation below is a defence-in-depth
 * measure that protects against any future refactor that might inadvertently
 * forward a URL, and satisfies Requirement 12.5 explicitly.
 *
 * All SSRF range checks are implemented in `src/shared/utils/ssrfValidator.ts`
 * and shared across the application.
 *
 * Blocked ranges (see ssrfValidator.ts for the full list):
 *  - 127.0.0.0/8    — loopback (IPv4)
 *  - 10.0.0.0/8     — RFC 1918 private
 *  - 172.16.0.0/12  — RFC 1918 private
 *  - 192.168.0.0/16 — RFC 1918 private
 *  - 169.254.0.0/16 — link-local
 *  - 100.64.0.0/10  — shared address space / cloud metadata
 *  - ::1             — loopback (IPv6)
 *  - "localhost"     — hostname alias
 *
 * Requirement 12.5: validate and sanitize all externally-supplied URLs before
 * making outbound requests; block requests to internal network addresses.
 */

/**
 * Re-exported for backwards compatibility and for consumers that need to check
 * whether a hostname is an SSRF target without constructing a full URL.
 *
 * @deprecated Prefer importing `isSsrfTarget` directly from
 *   `@/shared/utils/ssrfValidator` in new code.
 */
export { isSsrfTarget as isBlockedHost }

/**
 * Validates that the given URL is safe to fetch (not targeting internal infra).
 * Wraps `validateExternalUrl` from the shared SSRF validator and re-throws any
 * `ValidationError` as a `SsrfBlockedError` to preserve the client's public
 * error contract.
 */
function assertSafeUrl(rawUrl: string): void {
  try {
    validateExternalUrl(rawUrl)
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new SsrfBlockedError(err.message)
    }
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom error types
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when an outbound URL targets an internal/private network address. */
export class SsrfBlockedError extends AppError {
  constructor(message: string) {
    super(message, 'SSRF_BLOCKED', 403)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when the DataJud circuit breaker is in the OPEN state. */
export class CircuitOpenError extends AppError {
  constructor(retryAfterMs: number) {
    super(
      `DataJud circuit breaker is OPEN. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
      'CIRCUIT_OPEN',
      503,
      { retryAfterMs },
    )
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when the DataJud API returns a non-success HTTP status. */
export class DataJudHttpError extends AppError {
  constructor(statusCode: number, message: string) {
    super(
      `DataJud API error [HTTP ${statusCode}]: ${message}`,
      'DATAJUD_HTTP_ERROR',
      statusCode,
    )
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when the DataJud response fails Zod schema validation. */
export class DataJudPayloadError extends AppError {
  constructor(details: Record<string, unknown>) {
    super(
      'DataJud response payload failed schema validation',
      'DATAJUD_PAYLOAD_INVALID',
      502,
      details,
    )
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Breaker
// ─────────────────────────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit (default: 5). */
  failureThreshold: number
  /** Milliseconds to wait in OPEN state before transitioning to HALF_OPEN (default: 30_000). */
  resetTimeoutMs: number
}

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
}

/**
 * In-memory circuit breaker implementation.
 *
 * State machine:
 *   CLOSED ──(5 consecutive failures)──► OPEN
 *   OPEN   ──(30 s elapsed)────────────► HALF_OPEN
 *   HALF_OPEN ──(success)──────────────► CLOSED
 *   HALF_OPEN ──(failure)──────────────► OPEN
 */
export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private consecutiveFailures = 0
  private openedAt: number | null = null
  private readonly config: CircuitBreakerConfig

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config }
  }

  get currentState(): CircuitState {
    return this.state
  }

  get failureCount(): number {
    return this.consecutiveFailures
  }

  /**
   * Checks whether a request can proceed.
   *
   * - CLOSED: always allow
   * - OPEN: check if the reset timeout has elapsed; if so, transition to HALF_OPEN
   * - HALF_OPEN: allow exactly one probe request
   *
   * @throws CircuitOpenError when the circuit is open and the timeout has not elapsed
   */
  allowRequest(): void {
    if (this.state === 'CLOSED') return

    if (this.state === 'OPEN') {
      const elapsed = Date.now() - (this.openedAt ?? 0)
      const remaining = this.config.resetTimeoutMs - elapsed
      if (remaining > 0) {
        throw new CircuitOpenError(remaining)
      }
      // Timeout elapsed — probe with HALF_OPEN
      this.state = 'HALF_OPEN'
      return
    }

    // HALF_OPEN — allow the single probe request through
  }

  /** Records a successful request and resets the circuit to CLOSED. */
  onSuccess(): void {
    this.consecutiveFailures = 0
    this.openedAt = null
    this.state = 'CLOSED'
  }

  /**
   * Records a failed request.
   * - In CLOSED state: increments failure counter; opens circuit when threshold reached
   * - In HALF_OPEN state: immediately re-opens the circuit
   */
  onFailure(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN'
      this.openedAt = Date.now()
      return
    }

    this.consecutiveFailures++
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.state = 'OPEN'
      this.openedAt = Date.now()
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DataJud Client
// ─────────────────────────────────────────────────────────────────────────────

/** Base URL of the public DataJud API — hardcoded, never user-supplied. */
const DATAJUD_BASE_URL = 'https://api-publica.datajud.cnj.jus.br'

/** Timeout (ms) for each individual HTTP request to DataJud. */
const REQUEST_TIMEOUT_MS = 10_000

/**
 * HTTP client for the public DataJud / CNJ API.
 *
 * Responsibilities:
 *  1. SSRF protection — validates the hardcoded base URL on construction and
 *     before each request (defence-in-depth).
 *  2. Circuit Breaker — prevents cascading failures when DataJud is unavailable.
 *  3. Request timeout — aborts requests that take longer than 10 seconds.
 *  4. Response validation — validates and sanitizes the response payload with
 *     Zod before returning it to callers.
 *
 * Requirements:
 *  - 7.7 — DataJud queries must never block user operations
 *  - 7.9 — validate/sanitize payload before persisting; refuse malformed payloads
 *  - 12.5 — block SSRF; do not follow redirects to internal addresses
 */
export class DataJudClient {
  private readonly baseUrl: string
  readonly circuitBreaker: CircuitBreaker

  constructor(
    baseUrl: string = DATAJUD_BASE_URL,
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>,
  ) {
    // Validate the base URL once on construction so misconfiguration is caught
    // early — even though the default URL is safe, this satisfies Req 12.5.
    assertSafeUrl(baseUrl)
    this.baseUrl = baseUrl
    this.circuitBreaker = new CircuitBreaker(circuitBreakerConfig)
  }

  /**
   * Fetches process data from DataJud by CNJ number.
   *
   * @param cnjNumber - The CNJ process number (e.g. `0000001-23.2024.8.26.0001`).
   * @returns The validated process response, or `null` when the process is not
   *          found (HTTP 404) or the result set is empty.
   *
   * @throws CircuitOpenError - when the circuit breaker is open
   * @throws DataJudHttpError - for 4xx/5xx responses
   * @throws DataJudPayloadError - when the response body fails schema validation
   */
  async fetchProcess(
    cnjNumber: string,
  ): Promise<DataJudProcessResponse | null> {
    // Circuit breaker gate — throws immediately when OPEN
    this.circuitBreaker.allowRequest()

    // Build the request URL (hardcoded base, CNJ number appended as path)
    // The CNJ number is URL-encoded to prevent path-injection.
    const url = `${this.baseUrl}/_search/processo/numero/${encodeURIComponent(cnjNumber)}`

    // Validate the final URL against the SSRF blocklist (defence-in-depth)
    assertSafeUrl(url)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        // Prevent automatic redirect following that could be used to bypass
        // the SSRF blocklist by redirecting to an internal address.
        redirect: 'error',
      })
    } catch (err) {
      this.circuitBreaker.onFailure()
      if (err instanceof Error && err.name === 'AbortError') {
        throw new DataJudHttpError(
          504,
          `Request to DataJud timed out after ${REQUEST_TIMEOUT_MS}ms`,
        )
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }

    // 404 — process not found; not a circuit-breaker failure
    if (response.status === 404) {
      this.circuitBreaker.onSuccess()
      return null
    }

    // 4xx/5xx — treat as failure
    if (!response.ok) {
      this.circuitBreaker.onFailure()
      const bodyText = await response.text().catch(() => '(unreadable body)')
      throw new DataJudHttpError(
        response.status,
        bodyText.slice(0, 500), // truncate to avoid enormous error messages
      )
    }

    // Parse and validate the response body
    let json: unknown
    try {
      json = await response.json()
    } catch {
      this.circuitBreaker.onFailure()
      throw new DataJudPayloadError({ reason: 'Response body is not valid JSON' })
    }

    const parsed = DataJudProcessSchema.safeParse(json)
    if (!parsed.success) {
      this.circuitBreaker.onFailure()
      throw new DataJudPayloadError({
        reason: 'Response does not match expected schema',
        issues: parsed.error.issues,
      })
    }

    // Empty result set — treat as "not found"
    if (parsed.data.hits.hits.length === 0) {
      this.circuitBreaker.onSuccess()
      return null
    }

    this.circuitBreaker.onSuccess()
    return parsed.data
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

/** Shared singleton instance ready for use across the application. */
export const dataJudClient = new DataJudClient()
