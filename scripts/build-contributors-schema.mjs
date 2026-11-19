// Writes docs/contributors.schema.json, the JSON Schema of the contributors file (the v1 JSON
// export) that `credit-matrix` reads, from the zod schema the core validates it with:
//   node scripts/build-contributors-schema.mjs
// src/contributors-schema.test.ts fails when the file is stale.

// biome-ignore-all lint/correctness/noNodejsModules: Node build script, not client code.

import { writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import * as z from "zod/mini";

/** The checks JSON Schema cannot express, by field. Every refinement in the zod schema needs one. */
const UNEXPRESSED = {
  authors: "No two authors share an `id`.",
  "authors[].name": "`name` holds at least one letter, or is an ORCID iD.",
  "authors[].orcid":
    "`orcid` is an ORCID iD with a valid check digit, bare (`0000-0002-1825-0097`) or as an orcid.org URL.",
};

/** `["properties","authors","items","properties","name"]` as `authors[].name`. */
function fieldName(path) {
  return path
    .filter((key) => key !== "properties" && key !== "anyOf" && key !== "allOf")
    .map((key) => (key === "items" ? "[]" : `.${key}`))
    .join("")
    .replace(/^\./, "")
    .replaceAll(".[]", "[]");
}

/**
 * The file's text. `exportSchema` is the core's JSON export schema (`src/core/export/json.ts`), passed
 * in so the test can hand over the source and the script a fresh load of it.
 */
export function renderContributorsSchema(exportSchema) {
  const refined = new Set();
  // `asks` holds the app's ask-and-reply state, which a hand-written file has no use for.
  const schema = z.toJSONSchema(z.omit(exportSchema, { asks: true }), {
    io: "input",
    override({ zodSchema, jsonSchema, path }) {
      const def = zodSchema._zod.def;
      // A default from a function (the random `id`) changes on every read, so it is left out.
      if (def.type === "default" && !isDeepStrictEqual(def.defaultValue, def.defaultValue)) delete jsonSchema.default;
      if (def.checks?.some((check) => check._zod.def.check === "custom")) refined.add(fieldName(path));
    },
  });
  const documented = Object.keys(UNEXPRESSED);
  if (refined.size !== documented.length || !documented.every((field) => refined.has(field))) {
    throw new Error(`Refined fields ${[...refined].join(", ")} differ from those UNEXPRESSED documents.`);
  }
  const { $schema, ...rest } = schema;
  const data = {
    $schema,
    $comment: "By scripts/build-contributors-schema.mjs from src/core. Do not edit.",
    title: "CRediT Matrix contributors file",
    description: [
      "The JSON file `credit-matrix` reads and `convert --to json` writes (version 1).",
      "A missing `id` gets a random one.",
      "Unknown fields are ignored. `asks` is the app's ask-and-reply state, left out here.",
      `JSON Schema cannot express these checks, which the CLI still applies: ${Object.values(UNEXPRESSED).join(" ")}`,
    ].join(" "),
    ...rest,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { runnerImport } = await import("vite");
  const source = fileURLToPath(new URL("../src/core/export/json.ts", import.meta.url));
  const { module } = await runnerImport(source, { configFile: false, logLevel: "error" });
  const out = fileURLToPath(new URL("../docs/contributors.schema.json", import.meta.url));
  await writeFile(out, renderContributorsSchema(module.ExportSchema));
}
