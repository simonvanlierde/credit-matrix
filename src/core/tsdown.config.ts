import { defineConfig } from "tsdown";

// No hashes in file names: the type snapshot test compares dist/*.d.ts by name.
// The build script empties dist first: the two builds run at once, and one cleaning could erase the other.
export default defineConfig([
  {
    entry: { index: "index.ts", lookup: "lookup.ts", i18n: "i18n.ts", element: "element.ts" },
    platform: "neutral",
    dts: true,
    tsconfig: "tsconfig.build.json",
    hash: false,
    fixedExtension: false,
    clean: false,
  },
  {
    // linkedom is a dev dependency, so it is bundled here and never installed by library users.
    // One file, so its locale chunks cannot overwrite the library's.
    entry: { cli: "cli.ts" },
    outputOptions: { codeSplitting: false },
    minify: true,
    platform: "node",
    dts: false,
    hash: false,
    fixedExtension: false,
    clean: false,
  },
]);
