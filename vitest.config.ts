// biome-ignore lint/correctness/noNodejsModules: this config runs in Node, not the browser bundle.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for plain TypeScript: the domain logic in `src/core`, the Zustand
 * store, and the `src/lib` helpers. User-visible behaviour is covered by
 * Playwright in `e2e/`.
 *
 * `jsdom` rather than `node`: the code under test reaches for `DOMParser`,
 * `localStorage`, `navigator`, and `Blob` the way it does in the browser.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    restoreMocks: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Node's experimental `localStorage` global is unusable without
    // `--localstorage-file` and shadows jsdom's, so the store would persist
    // into nothing. Switch it off and jsdom's storage applies.
    execArgv: ["--no-experimental-webstorage"],
    coverage: {
      provider: "v8",
      // lcov feeds Codecov; text prints a summary in the terminal/CI log
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/core/**/*.ts", "src/lib/**/*.ts", "src/store/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      // A few points under the measured level: a drop fails CI, noise does not.
      thresholds: { statements: 95, branches: 87, functions: 97, lines: 97 },
    },
  },
  // The app's tsconfig sets `jsx: preserve` for Next's own compiler, so the
  // test build has to be told how to handle JSX itself.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
