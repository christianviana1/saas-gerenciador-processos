import { NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Generates a cryptographically random nonce for use in Content-Security-Policy.
 * Uses 16 random bytes encoded as base64.
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

/**
 * Returns all security headers as a plain object for use in next.config.mjs headers().
 * The CSP is built dynamically using the provided nonce.
 *
 * @param nonce - A base64-encoded random nonce to allow specific inline scripts
 */
export function getSecurityHeaders(nonce: string): Record<string, string> {
  const csp = buildCSP(nonce);

  return {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    "Content-Security-Policy": csp,
  };
}

/**
 * Applies all required security headers to a NextResponse.
 * If a nonce is provided it is used in the CSP script-src directive.
 * If no nonce is provided, a fresh one is generated automatically.
 *
 * @param response - The NextResponse to apply headers to
 * @param nonce    - Optional nonce; a new one is generated when omitted
 * @returns The mutated NextResponse with all security headers set
 */
export function applySecurityHeaders(
  response: NextResponse,
  nonce?: string
): NextResponse {
  const effectiveNonce = nonce ?? generateNonce();
  const headers = getSecurityHeaders(effectiveNonce);

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Builds the Content-Security-Policy header value.
 * - Uses a per-request nonce for script-src instead of 'unsafe-inline'.
 * - style-src keeps 'unsafe-inline' because CSS-in-JS / Tailwind inject styles at runtime.
 * - frame-ancestors 'none' mirrors X-Frame-Options: DENY (Requirement 12.9).
 */
function buildCSP(nonce: string): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  return directives.join("; ");
}
