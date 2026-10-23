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
  // Stryker rewrites the tsconfig through the TypeScript JS API, which TypeScript 7 no longer has.
  // No tsconfig reaches outside the sandbox, so I point it at a file that does not exist.
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
