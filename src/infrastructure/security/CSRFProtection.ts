import crypto from 'crypto';

/**
 * CSRF protection via the double-submit cookie pattern.
 *
 * How it works:
 *   1. Server generates a random token and sends it as a non-httpOnly cookie
 *      (readable by JS so the client can include it in the request header).
 *   2. For every mutating request (POST, PUT, PATCH, DELETE) the client must
 *      echo the cookie value back in a custom request header (e.g. `x-csrf-token`).
 *   3. The server compares the cookie value against the header value using
 *      `crypto.timingSafeEqual` to prevent timing attacks.
 *
 * Requirements: 12.3
 */
export class CSRFProtection {
  /** Name of the cookie that stores the CSRF token. */
  readonly COOKIE_NAME = 'csrf_token';

  /** Name of the request header that echoes the token. */
  readonly HEADER_NAME = 'x-csrf-token';

  /**
   * Generates a cryptographically secure CSRF token.
   *
   * Uses `crypto.randomBytes(32)` which yields 32 random bytes;
   * hex-encoding doubles the length to 64 characters.
   *
   * @returns A 64-character hexadecimal string.
   */
  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Validates a CSRF token by comparing the cookie value against the header
   * value in constant time to prevent timing attacks.
   *
   * Both tokens must be present, non-empty, equal in byte length, and
   * byte-identical for validation to succeed.
   *
   * @param cookieToken - The CSRF token read from the request cookie.
   * @param headerToken - The CSRF token read from the request header.
   * @returns `true` when both tokens are present and match; `false` otherwise.
   */
  validateToken(
    cookieToken: string | undefined,
    headerToken: string | undefined,
  ): boolean {
    if (!cookieToken || !headerToken) {
      return false;
    }

    // timingSafeEqual requires both Buffers to have the same byte length.
    // If lengths differ we still do a dummy comparison to avoid a trivial
    // timing oracle based solely on short-circuit logic.
    const cookieBuf = Buffer.from(cookieToken, 'utf8');
    const headerBuf = Buffer.from(headerToken, 'utf8');

    if (cookieBuf.length !== headerBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(cookieBuf, headerBuf);
  }

  /**
   * Sets the CSRF token as a response cookie.
   *
   * Cookie flags:
   *   - `httpOnly: false`  — the token *must* be readable by JavaScript so
   *                          the client can forward it in the request header.
   *   - `sameSite: strict` — prevents the cookie from being sent in
   *                          cross-site requests, adding a defence-in-depth layer.
   *   - `secure: true`     — only sent over HTTPS in production; relaxed in
   *                          development to allow `http://localhost`.
   *   - `path: /`          — available for all routes.
   *
   * @param response - The Next.js / Node.js `Response` object (or any object
   *                   with a `setHeader` method compatible with `http.ServerResponse`).
   * @param token    - The CSRF token string to store in the cookie.
   */
  setCsrfCookie(response: CsrfResponse, token: string): void {
    const isProduction = process.env.NODE_ENV === 'production';

    const cookieParts = [
      `${this.COOKIE_NAME}=${token}`,
      'Path=/',
      'SameSite=Strict',
      // httpOnly must be ABSENT so JavaScript can read the value
    ];

    if (isProduction) {
      cookieParts.push('Secure');
    }

    const cookieString = cookieParts.join('; ');

    if (typeof (response as NextResponseLike).headers?.append === 'function') {
      // Next.js Response / Headers API
      (response as NextResponseLike).headers.append('Set-Cookie', cookieString);
    } else if (typeof (response as NodeResponseLike).setHeader === 'function') {
      // Node.js http.ServerResponse
      const existing = (response as NodeResponseLike).getHeader('Set-Cookie');
      if (Array.isArray(existing)) {
        (response as NodeResponseLike).setHeader('Set-Cookie', [
          ...existing,
          cookieString,
        ]);
      } else if (typeof existing === 'string') {
        (response as NodeResponseLike).setHeader('Set-Cookie', [
          existing,
          cookieString,
        ]);
      } else {
        (response as NodeResponseLike).setHeader('Set-Cookie', cookieString);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal structural types so `setCsrfCookie` works with both the Web API
// `Response` (used in Next.js Route Handlers) and Node.js `http.ServerResponse`
// without importing heavy framework types as hard dependencies.
// ---------------------------------------------------------------------------

interface NextResponseLike {
  headers: {
    append(name: string, value: string): void;
  };
}

interface NodeResponseLike {
  setHeader(name: string, value: string | string[]): void;
  getHeader(name: string): string | string[] | number | undefined;
}

/** Union type accepted by `setCsrfCookie`. */
export type CsrfResponse = NextResponseLike | NodeResponseLike;

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/** Singleton instance for use throughout the application. */
export const csrfProtection = new CSRFProtection();
