// biome-ignore-all lint/correctness/noNodejsModules: compares the vendored files with the pinned npm package.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const upstream = new URL("../../../node_modules/harfbuzzjs/", import.meta.url);
const read = (path: string, base: URL) => readFileSync(new URL(path, base));

it("vendors harfbuzzjs files byte for byte from the pinned devDependency", () => {
  const { version } = JSON.parse(read("package.json", upstream).toString());
  for (const file of ["harfbuzz.wasm", "harfbuzz-subset.wasm"])
    expect(read(file, new URL("../../fonts/", import.meta.url)).equals(read(`dist/${file}`, upstream))).toBe(true);
  // The loader adds only a one-line license header.
  const [header, ...rest] = read("../vendor/harfbuzz.js", new URL(import.meta.url))
    .toString()
    .split("\n");
  expect(header).toMatch(new RegExp(`^/\\*! harfbuzzjs ${version.replaceAll(".", "\\.")}, dist/harfbuzz\\.js `));
  expect(rest.join("\n") === read("dist/harfbuzz.js", upstream).toString()).toBe(true);
});
