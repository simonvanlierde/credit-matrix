// biome-ignore-all lint/correctness/noNodejsModules: run the built CLI and validator against temporary metadata.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("validates the fragment merged into an RO-Crate 1.2 package, and rejects missing required metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "credit-matrix-ro-crate-"));
  try {
    const fragment = JSON.parse(
      execFileSync(
        "node",
        [
          resolve("src/core/dist/cli.js"),
          "convert",
          resolve("src/core/__tests__/fixtures/export-codemeta.json"),
          "--to",
          "ro-crate",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    const [links, ...entities] = fragment["@graph"];
    const root = {
      ...links,
      "@type": "Dataset",
      name: "Fictional microscopy data",
      description: "Synthetic metadata used to check the attribution export.",
      datePublished: "2026-01-01",
      license: "CC0-1.0",
    };
    const metadata = {
      "@context": fragment["@context"],
      "@graph": [
        {
          "@id": "ro-crate-metadata.json",
          "@type": "CreativeWork",
          about: { "@id": "./" },
          conformsTo: { "@id": "https://w3id.org/ro/crate/1.2" },
        },
        root,
        ...entities,
      ],
    };
    const validate = () =>
      spawnSync(
        "uvx",
        [
          "--from",
          "roc-validator==0.13.1",
          "rocrate-validator",
          "validate",
          directory,
          "--profile-identifier",
          "ro-crate-1.2",
          "--no-auto-profile",
          "--requirement-severity",
          "required",
          "--output-format",
          "json",
          "--no-paging",
        ],
        { encoding: "utf8", timeout: 120_000 },
      );
    const file = join(directory, "ro-crate-metadata.json");
    writeFileSync(file, JSON.stringify(metadata));
    const result = validate();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const expandedRoles = execFileSync(
      "uvx",
      [
        "--from",
        "roc-validator==0.13.1",
        "python",
        "-c",
        `
import json, sys
from rdflib import Graph, Namespace, RDF, URIRef
schema = Namespace("http://schema.org/")
graph = Graph().parse(sys.argv[1], format="json-ld")
terms = []
for role in graph.subjects(RDF.type, schema.Role):
    term = graph.value(role, schema.roleName)
    assert isinstance(term, URIRef), "roleName must expand to an IRI, not a literal"
    assert (term, RDF.type, schema.DefinedTerm) in graph
    for relationship in (schema.author, schema.contributor):
        person = graph.value(role, relationship)
        if person is not None:
            assert (person, RDF.type, schema.Person) in graph
            assert any(graph.subjects(relationship, role))
    terms.append(str(term))
print(json.dumps(sorted(terms)))
`,
        file,
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    expect(JSON.parse(expandedRoles)).toEqual([
      "https://credit.niso.org/contributor-roles/data-curation/",
      "https://credit.niso.org/contributor-roles/investigation/",
      "https://credit.niso.org/contributor-roles/software/",
    ]);
    // A green validator must enforce the base profile, rather than just parse JSON.
    writeFileSync(
      file,
      JSON.stringify({
        ...metadata,
        "@graph": metadata["@graph"].map((entry) => {
          if (entry["@id"] !== "./") return entry;
          const { description: _, ...invalid } = entry;
          return invalid;
        }),
      }),
    );
    const invalid = validate();
    expect(invalid.status, invalid.stdout + invalid.stderr).toBe(1);
    expect(invalid.stdout + invalid.stderr).toMatch(/description/i);
    writeFileSync(file, JSON.stringify(fragment));
    expect(validate().status).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 180_000);
