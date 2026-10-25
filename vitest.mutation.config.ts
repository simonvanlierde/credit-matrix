import { defineConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * The `core` project alone, for `pnpm mutation`.
 *
 * It drops the global setup and `package.test.ts`: they build and check `dist/`,
 * which a mutant in the source never reaches, so they would only slow each run.
 */
const core = base.test?.projects?.find(
  (project) => typeof project === "object" && "test" in project && project.test?.name === "core",
);
if (!(core && typeof core === "object" && "test" in core)) {
  throw new Error("vitest.config.ts has no `core` project");
}

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: [
      {
        ...core,
        test: {
          ...core.test,
          globalSetup: [],
          exclude: ["**/node_modules/**", "src/core/__tests__/package.test.ts"],
        },
      },
    ],
  },
});
