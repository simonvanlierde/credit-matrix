/**
 * Mutation testing of the import and export code in src/core, run with `pnpm mutation`.
 * It is not a CI gate: test/mutation-baseline.txt lists the mutants no test kills.
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: "pnpm",
  // pnpm keeps the runner out of the core's own node_modules, so Stryker does not find it by glob.
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.mutation.config.ts" },
  coverageAnalysis: "perTest",
  // The host runs a benchmark queue; 8 workers leave the rest of the cores free.
  concurrency: 8,
  // Stryker skips its tsconfig rewrite when the file is missing; the rewrite needs the TypeScript JS API,
  // which TypeScript 7 dropped. Remove once Stryker supports TS 7.
  tsconfigFile: "tsconfig.stryker-skip.json",
  mutate: [
    "src/core/export/**/*.ts",
    "src/core/import.ts",
    "src/core/share-payload.ts",
    "src/core/parse-authors.ts",
    "src/core/statement.ts",
  ],
  // The statement tests read the census corpus, so census/tests stays in the sandbox.
  ignorePatterns: ["census/*", "!census/tests", "e2e", "docs", "public", "integrations", "coverage", "reports"],
  reporters: ["clear-text", "progress", "json", "html"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  clearTextReporter: { allowColor: false, logTests: false },
  tempDirName: ".stryker-tmp",
};
