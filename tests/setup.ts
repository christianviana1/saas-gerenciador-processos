/**
 * tests/setup.ts
 *
 * Global Vitest setup file — runs once before all test suites.
 * Configure matchers, global mocks, and environment here.
 */

import "@testing-library/jest-dom";

// ─────────────────────────────────────────────────────────────────
// Environment
// ─────────────────────────────────────────────────────────────────

// Set test environment variables before any module is imported
(process.env as any).NODE_ENV = "test";
process.env.DATABASE_URL =
  "mysql://test:test@localhost:3306/sistema_juridico_test";
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "6379";
process.env.REDIS_PASSWORD = "";
process.env.NEXTAUTH_SECRET = "test-secret-do-not-use-in-production-32chars";
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.AES_ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";
process.env.VAPID_PUBLIC_KEY = "test-vapid-public-key";
process.env.VAPID_PRIVATE_KEY = "test-vapid-private-key";
process.env.VAPID_SUBJECT = "mailto:test@example.com";
process.env.LOG_LEVEL = "silent";

// ─────────────────────────────────────────────────────────────────
// Global Hooks
// ─────────────────────────────────────────────────────────────────

// Suppress console.log in tests unless LOG_LEVEL=debug is set
if (process.env.LOG_LEVEL !== "debug") {
  const noop = () => {};
  globalThis.console = {
    ...console,
    log: noop,
    info: noop,
    debug: noop,
    // Keep warn and error visible so failures are easy to diagnose
  };
}

// ─────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────

// Restore mocks after each test — prevents test pollution
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
