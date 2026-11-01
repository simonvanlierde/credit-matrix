// biome-ignore-all lint/correctness/noNodejsModules: exercise installed CLIs against disposable files.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

// Includes the reviewed CodeMeta alias/non-ORCID fix, absent from citesync 0.2.0.
const citesync =
  "citesync @ https://github.com/simonvanlierde/citesync/archive/1625b9fe1b0e9195367852a20366ca9867d0de80.tar.gz";
const fixture = resolve("src/core/__tests__/fixtures/export-codemeta.json");
const directories: string[] = [];
const files = ["codemeta.json", "CITATION.cff", ".zenodo.json"];
const snapshot = (root: string) => files.map((file) => readFileSync(join(root, file), "utf8"));
const run = (root: string, command: "write" | "check") =>
  spawnSync("uvx", ["--from", citesync, "citesync", command, "--root", root, "--format", "json"], {
    encoding: "utf8",
    timeout: 120_000,
  });

function setup() {
  const root = mkdtempSync(join(tmpdir(), "credit-matrix-codemeta-"));
  directories.push(root);
  const output = execFileSync("node", [resolve("src/core/dist/cli.js"), "statement", fixture, "--format", "codemeta"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const metadata = {
    type: "SoftwareSourceCode",
    name: "Example microscopy tools",
    version: "1.0.0",
    ...JSON.parse(output),
  };
  writeFileSync(join(root, "codemeta.json"), JSON.stringify(metadata, null, 2));
  writeFileSync(join(root, "citesync.toml"), 'source = "codemeta.json"\nmanifests = []\n');
  writeFileSync(
    join(root, "CITATION.cff"),
    `cff-version: 1.2.0
title: Example microscopy tools
version: 1.0.0
authors:
  - given-names: M.
    family-names: Curie
    orcid: https://orcid.org/0000-0002-1825-0097
  - given-names: Antonie
    family-names: van Leeuwenhoek
`,
  );
  writeFileSync(
    join(root, ".zenodo.json"),
    JSON.stringify({
      title: "Example microscopy tools",
      version: "1.0.0",
      creators: [{ name: "Curie, M.", orcid: "0000-0002-1825-0097" }, { name: "van Leeuwenhoek, Antonie" }],
      contributors: [{ name: "Johnson, Katherine", type: "DataManager" }],
    }),
  );
  return root;
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true });
});

describe("Matrix CLI → citesync contribution contract", () => {
  it("writes hand-checked people, preserves roles and stays unchanged on a second write", () => {
    const root = setup();
    const original = readFileSync(join(root, "codemeta.json"), "utf8");
    const result = run(root, "write");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const cff = parse(readFileSync(join(root, "CITATION.cff"), "utf8"));
    expect(cff.authors).toEqual([
      { "given-names": "Marie", "family-names": "Skłodowska-Curie", orcid: "https://orcid.org/0000-0002-1825-0097" },
      { "given-names": "Antonie", "family-names": "van Leeuwenhoek" },
    ]);
    expect(cff.contributors).toBeUndefined();
    const zenodo = JSON.parse(readFileSync(join(root, ".zenodo.json"), "utf8"));
    expect(zenodo.creators).toEqual([
      { name: "Skłodowska-Curie, Marie", orcid: "0000-0002-1825-0097" },
      { name: "van Leeuwenhoek, Antonie" },
    ]);
    expect(zenodo.contributors).toEqual([{ name: "Johnson, Katherine", type: "DataManager" }]);
    expect(readFileSync(join(root, "codemeta.json"), "utf8")).toBe(original);
    const checked = run(root, "check");
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
    const before = snapshot(root);
    expect(run(root, "write").status).toBe(0);
    expect(snapshot(root)).toEqual(before);

    // A CFF-driven edit must also preserve document-local identifiers and roles.
    writeFileSync(join(root, "citesync.toml"), 'source = "CITATION.cff"\nmanifests = []\n');
    writeFileSync(
      join(root, "CITATION.cff"),
      readFileSync(join(root, "CITATION.cff"), "utf8").replace("1.0.0", "1.0.1"),
    );
    const reverse = run(root, "write");
    expect(reverse.status, reverse.stdout + reverse.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(root, "codemeta.json"), "utf8"))).toEqual({
      ...JSON.parse(original),
      version: "1.0.1",
    });
  }, 180_000);

  it("reports a new Zenodo contributor without choosing a type or replacing its contributor list", () => {
    const root = setup();
    const path = join(root, ".zenodo.json");
    const zenodo = JSON.parse(readFileSync(path, "utf8"));
    zenodo.contributors = [{ name: "Carberry, Josiah", type: "Other" }];
    writeFileSync(path, JSON.stringify(zenodo));
    const original = readFileSync(join(root, "codemeta.json"), "utf8");
    const result = run(root, "write");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Zenodo needs a type");
    expect(JSON.parse(readFileSync(path, "utf8")).contributors).toEqual(zenodo.contributors);
    expect(readFileSync(join(root, "codemeta.json"), "utf8")).toBe(original);
  }, 180_000);
});
