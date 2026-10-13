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

  it("runs the CLI with its bundled XML parser", () => {
    const run = (...args: string[]) => execFileSync("node", [`${dist}cli.js`, ...args], { encoding: "utf8" });
    const xml = fileURLToPath(new URL("fixtures/export-jats.xml", import.meta.url));
    expect(run("statement", xml)).toMatch(/^CRediT: /);
    expect(readFileSync(`${dist}cli.js`, "utf8")).not.toMatch(/from "linkedom"/);
  });
});
