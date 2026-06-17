/**
 * SSRF Validator — shared utility for blocking requests to internal network addresses.
 *
 * Implements Requirement 12.5:
 *   "THE Platform SHALL validar e sanitizar todas as URLs fornecidas por usuários antes
 *   de realizar requisições externas, bloqueando requisições para endereços de rede
 *   interna (127.0.0.1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) para prevenir SSRF."
 *
 * Blocked ranges:
 *  - 127.0.0.0/8    — loopback (IPv4)
 *  - 10.0.0.0/8     — RFC 1918 private class A
 *  - 172.16.0.0/12  — RFC 1918 private class B (172.16.x.x – 172.31.x.x)
 *  - 192.168.0.0/16 — RFC 1918 private class C
 *  - 169.254.0.0/16 — link-local (APIPA)
 *  - 100.64.0.0/10  — shared address space (cloud metadata proxies)
 *  - ::1            — IPv6 loopback
 *  - "localhost"    — hostname alias for loopback
 *
 * Usage:
 *   import { validateExternalUrl } from '@/shared/utils/ssrfValidator'
 *   validateExternalUrl(url) // throws ValidationError for blocked targets
 */

import { isIP } from 'net'
import { ValidationError } from '@/shared/errors/AppError'

// ─────────────────────────────────────────────────────────────────────────────
// Well-known blocked hostnames (resolved without DNS lookup)
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '[::1]',
  '0:0:0:0:0:0:0:1',
])

// ─────────────────────────────────────────────────────────────────────────────
// Allowed URL schemes
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

// ─────────────────────────────────────────────────────────────────────────────
// IPv4 octet parser helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a dotted-decimal IPv4 string into its four numeric octets.
 * Returns `null` when the string is not a valid IPv4 address.
 */
function parseIPv4(host: string): [number, number, number, number] | null {
  // Use Node's `net.isIP` as a fast sanity check before splitting
  if (isIP(host) !== 4) return null

  const parts = host.split('.')
  if (parts.length !== 4) return null

  const octets = parts.map(Number)
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return null

  return octets as [number, number, number, number]
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether a hostname or IP address is a known SSRF target
 * (i.e., resolves to an internal/private network address).
 *
 * This function performs a **static** check — it does not perform DNS
 * resolution. Callers that accept arbitrary hostnames should ensure DNS
 * rebinding protection is applied at a higher layer (e.g., validate the
 * resolved IP after lookup).
 *
 * @param hostname - The hostname or IP address to check (without brackets
 *   for IPv6; the function normalises bracketed IPv6 automatically).
 * @returns `true` when the hostname matches a blocked range; `false` otherwise.
 */
export function isSsrfTarget(hostname: string): boolean {
  const h = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '') // strip IPv6 brackets

  // ── 1. Exact blocklist ──────────────────────────────────────────────────────
  if (BLOCKED_HOSTNAMES.has(h)) return true

  // ── 2. IPv4 range checks ────────────────────────────────────────────────────
  const octets = parseIPv4(h)
  if (octets !== null) {
    const [o1, o2] = octets

    // 127.0.0.0/8 — loopback
    if (o1 === 127) return true

    // 10.0.0.0/8 — RFC 1918 class A
    if (o1 === 10) return true

    // 172.16.0.0/12 — RFC 1918 class B (172.16–31.x.x)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true

    // 192.168.0.0/16 — RFC 1918 class C
    if (o1 === 192 && o2 === 168) return true

    // 169.254.0.0/16 — link-local (APIPA)
    if (o1 === 169 && o2 === 254) return true

    // 100.64.0.0/10 — shared address space / cloud metadata proxies
    // Range: 100.64.0.0 – 100.127.255.255
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true

    return false
  }

  // ── 3. IPv6 loopback ────────────────────────────────────────────────────────
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true

  // ── 4. Numeric IPv6 — check for loopback in expanded form ──────────────────
  if (isIP(h) === 6) {
    // Normalise compressed IPv6 to detect loopback variations
    // Only the canonical loopback (::1) is checked above; other private IPv6
    // ranges (fc00::/7 ULA, fe80::/10 link-local) are blocked here.
    if (h.startsWith('fe80')) return true   // link-local
    if (h.startsWith('fc') || h.startsWith('fd')) return true // unique local (ULA)
  }

  return false
}

/**
 * Validates that `url` is safe to use as an outbound HTTP/HTTPS request
 * destination. Throws a `ValidationError` if the URL:
 *
 *  - Cannot be parsed as a URL
 *  - Uses a scheme other than `http:` or `https:`
 *  - Targets a private/internal network address (see module JSDoc for ranges)
 *
 * This is the primary function that application code should call before
 * performing any outbound fetch.
 *
 * @param url - The raw URL string to validate.
 * @throws {ValidationError} When the URL is invalid, uses a disallowed scheme,
 *   or targets an internal network address.
 *
 * @example
 * validateExternalUrl('https://api-publica.datajud.cnj.jus.br') // OK — no throw
 * validateExternalUrl('http://192.168.1.1/admin')              // throws ValidationError
 * validateExternalUrl('ftp://example.com')                     // throws ValidationError
 */
export function validateExternalUrl(url: string): void {
  // ── 1. Parse ────────────────────────────────────────────────────────────────
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ValidationError(`URL inválida ou mal formada: "${url}"`, {
      url,
      reason: 'malformed_url',
    })
  }

  // ── 2. Scheme check ─────────────────────────────────────────────────────────
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new ValidationError(
      `Protocolo não permitido: "${parsed.protocol}". Apenas HTTP e HTTPS são aceitos.`,
      { url, protocol: parsed.protocol, reason: 'disallowed_scheme' },
    )
  }

  // ── 3. SSRF target check ────────────────────────────────────────────────────
  const hostname = parsed.hostname
  if (isSsrfTarget(hostname)) {
    throw new ValidationError(
      `SSRF bloqueado: requisições para endereços de rede interna são proibidas (host: "${hostname}").`,
      { url, hostname, reason: 'ssrf_blocked' },
    )
  }
}
