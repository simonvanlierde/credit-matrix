// @vitest-environment node
// biome-ignore-all lint/correctness/noNodejsModules: this test reads the committed schema from disk.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv/dist/2020";
import { expect, it } from "vitest";
import * as z from "zod/mini";
import { renderContributorsSchema } from "../scripts/build-contributors-schema.mjs";
import { run } from "./core/cli";
import { ExportSchema } from "./core/export/json";

const committed = readFileSync(new URL("../docs/contributors.schema.json", import.meta.url), "utf8");
const validate = new Ajv({ allErrors: true }).compile(JSON.parse(committed));
const dir = mkdtempSync(join(tmpdir(), "credit-matrix-schema-"));

function file(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

it("keeps docs/contributors.schema.json in step with the core's JSON export schema", () => {
  // Regenerate with: node scripts/build-contributors-schema.mjs
  expect(committed).toBe(renderContributorsSchema(ExportSchema));
});

it("refuses to write the schema while a refinement it cannot express goes undocumented", () => {
  const extra = z.extend(ExportSchema, { title: z.string().check(z.refine((title) => title !== "")) });
  expect(() => renderContributorsSchema(extra)).toThrow("Refined fields");
});

it("accepts what convert --to json writes, from a list of names and from a CSV", async () => {
  const names = file("names.txt", "Grace Hopper\nCharles Darwin\n");
  const csv = file("team.csv", "Name,Conceptualization,Writing – original draft\nGrace Hopper,100,33\n");
  for (const input of [names, csv]) {
    const json = JSON.parse(String(await run(["convert", input, "--to", "json"])));
    expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
  }
});

it("accepts a hand-written file with only the required fields, as the CLI does", async () => {
  const author = { name: "Ada Lovelace", firstName: "Ada", middleName: "", surname: "Lovelace", initials: "AL" };
  const minimal = { version: 1, authors: [{ ...author, contributions: [{ role: "Software", score: 100 }] }] };
  expect(validate(minimal), JSON.stringify(validate.errors)).toBe(true);
  expect(await run(["statement", file("minimal.json", JSON.stringify(minimal))])).toBe(
    "CRediT: Software: Ada Lovelace",
  );
});

it("rejects a role name or score the CLI rejects", async () => {
  const author = { name: "Ada Lovelace", firstName: "Ada", middleName: "", surname: "Lovelace", initials: "AL" };
  for (const contribution of [
    { role: "Writing - original draft", score: 100 },
    { role: "Software", score: 101 },
  ]) {
    const bad = { version: 1, authors: [{ ...author, contributions: [contribution] }] };
    expect(validate(bad)).toBe(false);
    await expect(run(["statement", file("bad.json", JSON.stringify(bad))])).rejects.toThrow(/Check authors\.0/);
  }
});
