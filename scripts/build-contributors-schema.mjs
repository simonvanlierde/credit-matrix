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

/** Checks outside the zod schema that a file still has to pass. */
const OUTSIDE_THE_SCHEMA = ["The file is under 2 MB."];

/**
 * What each field means, from the JSDoc in src/core/author.ts, for tools that read this schema.
 * The `id` rule mirrors `isShareableId` there, which src/contributors-schema.test.ts checks.
 */
const FIELDS = {
  authors: { description: "The contributors, in byline order." },
  "authors[].id": {
    description:
      "Stable id. Letters, digits, `_` and `-`, up to 64 characters; the CLI replaces any other id with a random one.",
    pattern: "^[A-Za-z0-9_-]{1,64}$",
    not: { enum: Object.getOwnPropertyNames(Object.prototype) },
  },
  "authors[].name": { description: 'Display name as written, for example "Grace B. Hopper".' },
  "authors[].firstName": { description: "First name." },
  "authors[].middleName": { description: 'Middle names or initials; "" when there are none.' },
  "authors[].surname": { description: "Surname." },
  "authors[].initials": { description: 'Initials used in short statements, for example "GBH".' },
  "authors[].orcid": { description: "ORCID iD. Optional." },
  "authors[].contributorType": {
    description: "`author` for a named author, `non-author` for someone credited in the Acknowledgements.",
  },
  "authors[].contributions": {
    description: "One score per CRediT role. A role left out scores 0; a repeated role keeps its highest score.",
  },
  "authors[].contributions[].role": {
    description: "The NISO role name. The two Writing roles use an en dash (U+2013); `credit-matrix roles` lists them.",
  },
  "authors[].contributions[].score": {
    description: "0 is no contribution, 1 to 33 supporting, 34 to 66 equal, 67 to 100 lead.",
  },
  "authors[].equalContribution": { description: "Shares first authorship with the others so marked." },
  "authors[].corresponding": { description: "Is a corresponding author." },
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

/** The schema of `authors[].contributions[].role` within the generated `schema`; throws if it has none. */
function fieldSchema(schema, field) {
  let node = schema;
  for (const part of field.split(".")) {
    const key = part.replace(/\[\]$/, "");
    node = node?.properties?.[key];
    if (part.endsWith("[]")) node = node?.items;
  }
  if (!node) throw new Error(`FIELDS names ${field}, which the schema does not have.`);
  return node;
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
      // `defaultValue` is a getter that calls a function default on each read, so two reads differ
      // only for one like the random `id`, which would change the file on every run.
      if (def.type === "default" && !isDeepStrictEqual(def.defaultValue, def.defaultValue)) delete jsonSchema.default;
      if (def.checks?.some((check) => check._zod.def.check === "custom")) refined.add(fieldName(path));
    },
  });
  const documented = Object.keys(UNEXPRESSED);
  if (refined.size !== documented.length || !documented.every((field) => refined.has(field))) {
    throw new Error(`Refined fields ${[...refined].join(", ")} differ from those UNEXPRESSED documents.`);
  }
  for (const [field, extra] of Object.entries(FIELDS)) Object.assign(fieldSchema(schema, field), extra);
  const { $schema, ...rest } = schema;
  const data = {
    $schema,
    $comment: "By scripts/build-contributors-schema.mjs from src/core. Do not edit.",
    title: "CRediT Matrix contributors file",
    description: [
      "The JSON file `credit-matrix` reads and `convert --to json` writes (version 1).",
      "A missing `id` gets a random one.",
      "Other unknown fields are ignored.",
      "`asks` holds the app's ask-and-reply state: the CLI checks it, but this schema leaves it out, so leave it out of a file you write.",
      `JSON Schema cannot express these checks, which the CLI still applies: ${[...Object.values(UNEXPRESSED), ...OUTSIDE_THE_SCHEMA].join(" ")}`,
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
