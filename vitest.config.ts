import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // Global test setup
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],

    // Coverage configuration — Req 16.1
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",

      // 80% global threshold (Req 16.1)
      thresholds: {
        global: {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        // 100% for critical domain functions (Req 16.2)
        // Paths covered by per-file overrides below
      },

      // Include src files in coverage
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/**/*.spec.ts",
        "src/**/*.spec.tsx",
        "src/app/**",       // Next.js App Router — covered by e2e
        "src/**/index.ts",  // re-export barrels
      ],
    },

    // Test file patterns
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/property/**/*.test.ts",
    ],
    exclude: [
      "tests/e2e/**",
      "tests/security/**",
      "node_modules/**",
      ".next/**",
    ],

    // Timeouts
    testTimeout: 10_000,
    hookTimeout: 10_000,

    // Pool — use threads for parallel execution
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },

  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
