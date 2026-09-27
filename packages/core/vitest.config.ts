import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    restoreMocks: true,
    // These tests are pure functions with no cross-file global state, and the
    // one global the setup file sets (DOMParser) is assigned idempotently.
    // Sharing a worker across files skips re-importing linkedom for each one,
    // which was most of the run.
    isolate: false,
    // Timeout per test in milliseconds
    timeout: 10000,
    // Run this file before tests to provide DOMParser in Node via linkedom
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      // lcov feeds Codecov; text prints a summary in the terminal/CI log
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/test-setup.ts"],
      // A few points under the measured level: a drop fails CI, noise does not.
      thresholds: { statements: 94, branches: 84, functions: 95, lines: 95 },
    },
  },
});
