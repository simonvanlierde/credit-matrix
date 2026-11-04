import codspeedPlugin from "@codspeed/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * CodSpeed benchmarks for the TypeScript core, kept out of `vitest run` (its projects only pick up
 * `*.test.ts`). Run with `pnpm bench`; CI measures them in .github/workflows/codspeed.yml.
 */
export default defineConfig({
  plugins: [codspeedPlugin()],
  test: { environment: "node", include: ["src/core/bench/**/*.bench.ts"] },
});
