// biome-ignore-all lint/correctness/noNodejsModules: the build config runs in Node.

import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

// No hashes in file names: the type snapshot test compares dist/*.d.ts by name.
// The build script empties dist first: the two builds run at once, and one cleaning could erase the other.
export default defineConfig([
  {
    entry: { index: "index.ts", lookup: "lookup.ts", i18n: "i18n.ts", element: "element.ts", figures: "figures.ts" },
    // The browser element loads these modules directly, without an import map for Lingui.
    deps: { alwaysBundle: [/^@lingui\//] },
    platform: "neutral",
    env: { NODE_ENV: "production" },
    inputOptions: { resolve: { mainFields: ["module", "main"] } },
    dts: true,
    tsconfig: "tsconfig.build.json",
    hash: false,
    fixedExtension: false,
    clean: false,
  },
  {
    // linkedom is a dev dependency, so it is bundled here and never installed by library users.
    // One file, so its locale chunks cannot overwrite the library's.
    // zod is bundled too: loading its separate module files from node_modules takes about 25 ms at every start.
    entry: { cli: "cli.ts" },
    deps: { alwaysBundle: ["zod", /^zod\//] },
    outputOptions: { codeSplitting: false },
    minify: true,
    platform: "node",
    dts: false,
    hash: false,
    fixedExtension: false,
    clean: false,
  },
  {
    // The MyST plugin as one file: MyST runs a plugin from a URL out of its own cache, where bare
    // imports fail. The package and yaml are bundled in; the source is used so the builds stay independent.
    // No fonts: the renderer downloads the faces a figure needs into the machine's font cache.
    entry: { "myst-plugin": "../../integrations/myst/credit-matrix.mjs" },
    alias: {
      "credit-matrix/i18n": fileURLToPath(new URL("i18n.ts", import.meta.url)),
      "credit-matrix/figures": fileURLToPath(new URL("figures.ts", import.meta.url)),
      "credit-matrix": fileURLToPath(new URL("index.ts", import.meta.url)),
    },
    deps: { alwaysBundle: ["yaml", /^yaml\//, "zod", /^zod\//, /^@lingui\//, "pdf-lib", "@pdf-lib/fontkit"] },
    env: { NODE_ENV: "production" },
    outputOptions: { codeSplitting: false, entryFileNames: "[name].mjs" },
    minify: true,
    platform: "node",
    dts: false,
    hash: false,
    clean: false,
  },
]);
