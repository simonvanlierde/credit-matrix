# Add contribution roles to an RO-Crate

Choose **RO-Crate fragment** in the app's Export data menu, then Copy or Download.
The download is `credit-ro-crate-fragment.json`. The CLI produces the same JSON-LD:

```sh
pnpm dlx credit-matrix convert draft.json --to ro-crate > credit-ro-crate-fragment.json
```

This is attribution for an existing [RO-Crate 1.2](https://www.researchobject.org/ro-crate/specification/1.2/), not a standalone crate.
It contains people, CRediT `Role` entities and proposed `author` and `contributor` links for the root.
It does not invent a dataset name, description, publication date, licence, files or workflow details.
Your package must already supply those details and its metadata descriptor.

## Merge the fragment

In the JavaScript API, `toRoCrateFragment(authors)` returns `{ metadata, warnings }`.
The fragment's `@context` is `https://w3id.org/ro/crate/1.2/context`.
Its first `@graph` entry has `@id: "./"`, with the proposed root links.
The remaining entries describe people and roles.

1. Keep your package's existing context, root identifier and metadata descriptor.
   Ensure its context includes the RO-Crate 1.2 vocabulary.
2. Merge the first entry's `author` and `contributor` lists into the actual root entity.
   Preserve its other fields, including `name`, `description`, `datePublished`, `license` and `hasPart`.
3. Merge the remaining graph entries by `@id`. Keep one entity per identifier.
   Reconcile existing people and links before replacing attribution.
4. Save the completed document as `ro-crate-metadata.json` in your package.
   Validate that package against its RO-Crate profile.

ORCID URLs identify people when available. Other people get document-local identifiers such as
`#credit-matrix-person-2`. Role identifiers and these local person identifiers belong to this export;
they can change after reordering the roster. Reconcile them when merging into a crate that already uses those identifiers.
Re-export the attribution together instead of combining separate exports with overlapping local identifiers.

Each active CRediT role links to its NISO URL through `roleName: {"@id": "…"}`.
The graph describes each linked term as a named `DefinedTerm`.
The root links directly to people as well as their roles.
Following [Schema.org's Role pattern](https://schema.org/Role), each Role repeats the root's relationship:
`author` for authors, `contributor` for non-authors. People without assigned roles are absent.
Keep the native roster JSON for scores, contribution levels, equal contribution, correspondence and replies.

The export does not create a WorkflowHub deposit, a Zenodo record, a workflow definition or provenance for a workflow run.
Those packages need their own metadata and may require additional profiles.

## Check the integration

```sh
pnpm --filter credit-matrix build
pnpm exec vitest run integrations/ro-crate/credit-matrix.test.ts
```

The check merges the built CLI's output into fictional package metadata.
It runs `rocrate-validator` from the pinned `roc-validator==0.13.1` package through `uvx`.
The first run needs network access. It checks RO-Crate 1.2's required rules, then confirms that
missing required package metadata and an unmerged fragment both fail validation.
Core tests check names, ORCID identities, role links, non-authors and omitted scores separately.
The integration also expands the JSON-LD with RDFLib and checks that each role links to its CRediT term and Person.
