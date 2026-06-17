/**
 * Unit tests for the SSRF validator utility.
 *
 * Validates: Requirements 12.5
 */

import { describe, it, expect } from 'vitest'
import { isSsrfTarget, validateExternalUrl } from './ssrfValidator'
import { ValidationError } from '@/shared/errors/AppError'

// ─────────────────────────────────────────────────────────────────────────────
// isSsrfTarget — hostname/IP checks
// ─────────────────────────────────────────────────────────────────────────────

describe('isSsrfTarget', () => {
  // ── safe external addresses ────────────────────────────────────────────────
  it.each([
    ['api-publica.datajud.cnj.jus.br'],
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['203.0.113.1'],   // TEST-NET-3 — documentation range, not private
    ['example.com'],
    ['2606:4700:4700::1111'], // Cloudflare DNS (public IPv6)
  ])('returns false for safe host: %s', (host) => {
    expect(isSsrfTarget(host)).toBe(false)
  })

  // ── loopback ───────────────────────────────────────────────────────────────
  it.each([
    ['localhost'],
    ['127.0.0.1'],
    ['127.0.0.2'],
    ['127.255.255.255'],
    ['::1'],
    ['[::1]'],       // bracketed IPv6
    ['0:0:0:0:0:0:0:1'],
    ['0.0.0.0'],
  ])('blocks loopback: %s', (host) => {
    expect(isSsrfTarget(host)).toBe(true)
  })

  // ── RFC 1918 class A (10.0.0.0/8) ─────────────────────────────────────────
  it.each([
    ['10.0.0.1'],
    ['10.10.10.10'],
    ['10.255.255.255'],
  ])('blocks RFC 1918 class A: %s', (host) => {
    expect(isSsrfTarget(host)).toBe(true)
  })

  // ── RFC 1918 class B (172.16.0.0/12) ──────────────────────────────────────
  it.each([
    ['172.16.0.1'],
    ['172.20.0.1'],
    ['172.31.255.255'],
  ])('blocks RFC 1918 class B: %s', (host) => {
    expect(isSsrfTarget(host)).toBe(true)
  })

  it.each([
    ['172.15.255.255'], // just below the range
    ['172.32.0.0'],     // just above the range
  ])('does not block outside 172.16–31: %s', (host) => {
    expect(isSsrfTarget(host)).toBe(false)
  })

  // ── RFC 1918 class C (192.168.0.0/16) ─────────────────────────────────────
  it.each([
    ['192.168.0.1'],
    ['192.168.100.100'],
    ['192.168.255.255'],
  ])('blocks RFC 1918 class C: %s', (host) => {
    expect(isSsrfTarget(host)).toBe(true)
  })

  // ── Link-local (169.254.0.0/16) ───────────────────────────────────────────
  it.each([
    ['169.254.0.1'],
    ['169.254.169.254'], // AWS/GCP metadata service
    ['169.254.255.255'],
  ])('blocks link-local: %s', (host) => {
    expect(isSsrfTarget(host)).toBe(true)
  })

  // ── Shared address space (100.64.0.0/10) ──────────────────────────────────
  it.each([
    ['100.64.0.1'],
    ['100.100.100.100'],
    ['100.127.255.255'],
  ])('blocks shared address space (100.64/10): %s', (host) => {
    expect(isSsrfTarget(host)).toBe(true)
  })

  it.each([
    ['100.63.255.255'], // just below 100.64
    ['100.128.0.0'],    // just above 100.127
  ])('does not block outside 100.64–127: %s', (host) => {
    expect(isSsrfTarget(host)).toBe(false)
  })

  // ── IPv6 link-local and ULA ────────────────────────────────────────────────
  it('blocks IPv6 link-local fe80::', () => {
    expect(isSsrfTarget('fe80::1')).toBe(true)
  })

  it('blocks IPv6 ULA fc00::/7', () => {
    expect(isSsrfTarget('fc00::1')).toBe(true)
    expect(isSsrfTarget('fd00::1')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateExternalUrl
// ─────────────────────────────────────────────────────────────────────────────

describe('validateExternalUrl', () => {
  // ── safe URLs ──────────────────────────────────────────────────────────────
  it('accepts a valid HTTPS URL to the DataJud API', () => {
    expect(() =>
      validateExternalUrl('https://api-publica.datajud.cnj.jus.br'),
    ).not.toThrow()
  })

  it('accepts a valid HTTP URL to a public host', () => {
    expect(() => validateExternalUrl('http://example.com/path')).not.toThrow()
  })

  // ── malformed URLs ─────────────────────────────────────────────────────────
  it('throws ValidationError for a completely malformed URL', () => {
    expect(() => validateExternalUrl('not-a-url')).toThrow(ValidationError)
  })

  it('throws ValidationError for an empty string', () => {
    expect(() => validateExternalUrl('')).toThrow(ValidationError)
  })

  // ── disallowed schemes ─────────────────────────────────────────────────────
  it('throws ValidationError for ftp:// scheme', () => {
    expect(() => validateExternalUrl('ftp://example.com/file')).toThrow(
      ValidationError,
    )
  })

  it('throws ValidationError for file:// scheme', () => {
    expect(() => validateExternalUrl('file:///etc/passwd')).toThrow(
      ValidationError,
    )
  })

  it('throws ValidationError for javascript: scheme', () => {
    expect(() => validateExternalUrl('javascript:alert(1)')).toThrow(
      ValidationError,
    )
  })

  // ── SSRF targets via URL ───────────────────────────────────────────────────
  it.each([
    ['http://127.0.0.1/admin'],
    ['http://localhost/'],
    ['http://10.0.0.1/internal'],
    ['http://172.16.0.1:8080/api'],
    ['http://192.168.1.1/router'],
    ['http://169.254.169.254/latest/meta-data/'],  // AWS metadata
    ['http://100.100.100.100/'],                   // shared address space
    ['http://[::1]/'],                             // IPv6 loopback
  ])('throws ValidationError for internal URL: %s', (url) => {
    expect(() => validateExternalUrl(url)).toThrow(ValidationError)
  })

  // ── error message content ──────────────────────────────────────────────────
  it('includes "SSRF" in the error message for blocked IPs', () => {
    let err: unknown
    try {
      validateExternalUrl('http://192.168.0.1/secret')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).message).toMatch(/SSRF/i)
  })

  it('includes the blocked hostname in the error details', () => {
    let err: unknown
    try {
      validateExternalUrl('http://10.0.0.1/secret')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ValidationError)
    const details = (err as ValidationError).details
    expect(details?.hostname).toBe('10.0.0.1')
    expect(details?.reason).toBe('ssrf_blocked')
  })

  it('includes reason "disallowed_scheme" for non-HTTP/HTTPS URLs', () => {
    let err: unknown
    try {
      validateExternalUrl('ftp://example.com')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).details?.reason).toBe('disallowed_scheme')
  })

  it('includes reason "malformed_url" for unparseable URLs', () => {
    let err: unknown
    try {
      validateExternalUrl(':::not-a-url')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).details?.reason).toBe('malformed_url')
  })
})
