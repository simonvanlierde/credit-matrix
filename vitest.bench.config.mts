import codspeedPlugin from "@codspeed/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * Benchmarks for the `credit-matrix` package in `src/core`, run with
 * `pnpm bench`. Kept apart from vitest.config.ts so a benchmark run skips the
 * test projects' package build. The CodSpeed plugin only takes over when the
 * run happens under CodSpeed (in CI); locally the benches run as plain vitest.
 */
export default defineConfig({
  plugins: [codspeedPlugin()],
  test: {
    environment: "node",
    // linkedom stands in for the browser's DOMParser in the XML import, as in the core tests.
    setupFiles: ["src/core/__tests__/setup.ts"],
    benchmark: {
      include: ["src/core/__bench__/**/*.bench.ts"],
    },
  },
});
