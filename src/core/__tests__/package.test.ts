// biome-ignore-all lint/correctness/noNodejsModules: this test reads the built package from disk and runs its CLI.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The built package, as an installer sees it: dist/ via the exports map, never the source.
// global-setup.ts builds it before this project runs.
const dist = fileURLToPath(new URL("../dist/", import.meta.url));

describe("the built credit-matrix package", () => {
  it("exports exactly the public names from each entry point", async () => {
    const entries = {
      ".": await import("credit-matrix"),
      "./lookup": await import("credit-matrix/lookup"),
      "./i18n": await import("credit-matrix/i18n"),
    };
    const names = Object.fromEntries(Object.entries(entries).map(([entry, mod]) => [entry, Object.keys(mod).sort()]));
    expect(names).toMatchSnapshot();
  });

  it("keeps its public types as committed", async () => {
    const declarations = readdirSync(dist)
      .filter((name) => name.endsWith(".d.ts"))
      .sort()
      .map((name) => `// ${name}\n${readFileSync(`${dist}${name}`, "utf8")}`)
      .join("\n");
    await expect(declarations).toMatchFileSnapshot("__snapshots__/public-api.d.ts.snap");
  });

  it("publishes dist, the README, the licence and every file the exports map and bin point at", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    // Scripts off: prepack would rebuild dist/ under the other tests reading it.
    const packed = JSON.parse(
      execFileSync("pnpm", ["pack", "--dry-run", "--json", "--config.ignore-scripts=true"], {
        cwd: root,
        encoding: "utf8",
      }),
    ) as { files: { path: string }[] };
    const files = packed.files.map((file) => file.path).sort();
    const expected = [...readdirSync(dist).map((name) => `dist/${name}`), "LICENSE", "README.md", "package.json"];
    expect(files).toEqual(expected.sort());

    const manifest = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
    for (const target of [...Object.values(manifest.exports), ...Object.values(manifest.bin), manifest.types]) {
      expect(files).toContain(String(target).replace(/^\.\//, ""));
    }
  });

  it("runs the CLI with its bundled XML parser", () => {
    const run = (...args: string[]) => execFileSync("node", [`${dist}cli.js`, ...args], { encoding: "utf8" });
    const xml = fileURLToPath(new URL("fixtures/export-jats.xml", import.meta.url));
    expect(run("statement", xml)).toMatch(/^CRediT: /);
    // The CLI is minified, so an import of a dependency reads `from"zod/mini"`.
    expect(readFileSync(`${dist}cli.js`, "utf8")).not.toMatch(/from\s*"(linkedom|zod)/);
  });

  it("lets an app that never validates drop zod from its bundle", async () => {
    const { rolldown } = await import("rolldown");
    // An app's bundle of index.js that uses one export, as a bundler that tree-shakes builds it.
    const bundle = async (name: string) => {
      const build = await rolldown({
        input: "entry",
        plugins: [
          {
            name: "entry",
            resolveId: (id) => (id === "entry" ? id : null),
            load: (id) => (id === "entry" ? `import { ${name} } from "${dist}index.js"; console.log(${name});` : null),
          },
        ],
        logLevel: "silent",
      });
      const { output } = await build.generate({ format: "esm" });
      return output[0].code;
    };
    // zod names its schema classes with strings like "$ZodObject", which survive bundling.
    expect(await bundle("generateStatement")).not.toMatch(/\$Zod/);
    expect(await bundle("fromJson")).toMatch(/\$ZodObject/);
  });
});
