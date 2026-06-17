import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration — Req 16.3, 17.3
 * See: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",

  // Run all tests in parallel
  fullyParallel: true,

  // Fail the build on CI if test.only is left in source
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["list"],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for the application
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",

    // Collect trace on test failure
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on first retry
    video: "on-first-retry",

    // Browser context options
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },

  // Test projects — desktop + mobile
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    // Mobile viewports
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 13"] },
    },
  ],

  // Dev server — start Next.js before running E2E tests
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  // Output dir for test artifacts
  outputDir: "test-results",

  // Global timeout for each test
  timeout: 30_000,

  // Global expect timeout
  expect: {
    timeout: 5_000,
  },
});
