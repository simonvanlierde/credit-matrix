// biome-ignore-all lint/correctness/noNodejsModules: this test lists what `npm pack` would publish.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { FIGURE_FONT_FILES } from "./core/figure-fonts";

// Vitest runs from the repository root.
const folder = "src/fonts";

it("publishes index.js's faces, the licences and the readme, and nothing else", () => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: folder, encoding: "utf8" });
  const files = new Set((JSON.parse(out)[0].files as { path: string }[]).map(({ path }) => path));
  const faces = [...readFileSync(`${folder}/index.js`, "utf8").matchAll(/new URL\("\.\/([^"]+)"/g)].map(
    ([, file]) => file,
  );
  expect(faces.sort()).toEqual(
    Object.values(FIGURE_FONT_FILES)
      .map(({ file }) => file)
      .sort(),
  );
  const expected = new Set([
    ...faces,
    "index.js",
    "index.d.ts",
    "package.json",
    "README.md",
    "LICENSE",
    "OFL-NotoSans.txt",
    "OFL-NotoSansCJK.txt",
    "OFL-NotoSerifCJK.txt",
    "OFL-NotoScripts.txt",
    "LICENSE-harfbuzz.txt",
  ]);
  expect([...files].sort()).toEqual([...expected].sort());
});
