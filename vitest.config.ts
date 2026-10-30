// biome-ignore lint/correctness/noNodejsModules: this config runs in Node, not the browser bundle.
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

/**
 * Unit tests for plain TypeScript, in three projects:
 *
 * - `core`: the published package in `src/core`, under `node`, so a reach for a
 *   browser global fails here before it fails for a package user. linkedom
 *   stands in for the `DOMParser` the XML import defaults to.
 * - `app`: the Zustand store, `src/lib` and the components, under `jsdom`,
 *   because they reach for `localStorage`, `navigator` and `Blob` the way they
 *   do in the browser.
 * - `integrations`: the Quarto, MyST and Typst renderers in `integrations/`, under `node`.
 *
 * User-visible behaviour is covered by Playwright in `e2e/`.
 */
export default defineConfig({
  test: {
    globals: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      // lcov feeds Codecov; text prints a summary in the terminal/CI log
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/core/**/*.ts", "src/lib/**/*.ts", "src/store/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/core/__tests__/**",
        "src/core/dist/**",
        "src/core/tsdown.config.ts",
      ],
      // A few points under the measured level: a drop fails CI, noise does not.
      thresholds: { statements: 97, branches: 91, functions: 99, lines: 99 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "core",
          environment: "node",
          include: ["src/core/**/*.test.ts"],
          setupFiles: ["src/core/__tests__/setup.ts"],
          globalSetup: ["src/core/__tests__/global-setup.ts"],
        },
      },
      {
        extends: true,
        test: { name: "integrations", environment: "node", include: ["integrations/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "app",
          environment: "jsdom",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: [...configDefaults.exclude, "src/core/**"],
          // Node's experimental `localStorage` global is unusable without
          // `--localstorage-file` and shadows jsdom's, so the store would persist
          // into nothing. Switch it off and jsdom's storage applies.
          execArgv: ["--no-experimental-webstorage"],
        },
      },
    ],
  },
  // The app's tsconfig sets `jsx: preserve` for Next's own compiler, so the
  // test build has to be told how to handle JSX itself.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    // `@/core` is the package's source, not the directory's package.json, which points at dist.
    alias: [
      { find: /^@\/core$/, replacement: `${src}/core/index.ts` },
      { find: "@", replacement: src },
    ],
  },
});
