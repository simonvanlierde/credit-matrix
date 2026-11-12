# Add contribution roles to an RO-Crate

In the app, open the Export data menu, choose **RO-Crate fragment**, then Copy or Download.
The download is `credit-ro-crate-fragment.json`. The CLI produces the same JSON-LD:

<!-- live: ro-crate -->

```sh
pnpm dlx credit-matrix convert draft.json --to ro-crate > credit-ro-crate-fragment.json
```

The fragment adds attribution to an existing [RO-Crate 1.2](https://www.researchobject.org/ro-crate/specification/1.2/). It is not a standalone crate.
It holds people, CRediT `Role` entities and proposed `author` and `contributor` links for the root.
It has no dataset name, description, publication date, licence, files or workflow details.
Your package must already supply those and its metadata descriptor.

## Merge the fragment

The fragment's `@context` is `https://w3id.org/ro/crate/1.2/context`.
Its first `@graph` entry has `@id: "./"` and holds the proposed root links.
The other entries describe people and roles. The JavaScript API returns the same fragment:
`toRoCrateFragment(authors)` gives `{ metadata, warnings }`.

1. Keep your package's context, root identifier and metadata descriptor.
   Make sure the context includes the RO-Crate 1.2 vocabulary.
2. Merge the first entry's `author` and `contributor` lists into your root entity.
   Keep its other fields, including `name`, `description`, `datePublished`, `license` and `hasPart`.
3. Merge the other graph entries by `@id`, so each identifier has one entity.
   Reconcile existing people and links before you replace any attribution.
4. Save the result as `ro-crate-metadata.json` in your package.
   Validate the package against its RO-Crate profile.

A person with an ORCID is identified by the ORCID URL. Everyone else gets a document-local
identifier such as `#credit-matrix-person-2`. These local person identifiers and the role identifiers
belong to this export and can change when you reorder the roster. If your crate already uses the
same identifiers, reconcile them when you merge. Re-export all the attribution together instead of
combining separate exports whose local identifiers overlap.

Each active CRediT role links to its NISO URL through `roleName: {"@id": "…"}`.
The graph describes each linked term as a named `DefinedTerm`.
The root links to people directly and through their roles.
Following [Schema.org's Role pattern](https://schema.org/Role), each Role repeats the root's relationship:
`author` for authors, `contributor` for non-authors. People without assigned roles are left out.
Keep the native roster JSON for scores, contribution levels, equal contribution, correspondence and replies.

The export does not create a WorkflowHub deposit, a Zenodo record, a workflow definition or run provenance.
Those packages need their own metadata and may need additional profiles.

## Check the integration

```sh
pnpm --filter credit-matrix build
pnpm exec vitest run integrations/ro-crate/credit-matrix.test.ts
```

The check merges the built CLI's output into fictional package metadata and runs `rocrate-validator`
from the pinned `roc-validator==0.13.1` package through `uvx`. The first run needs network access.
It checks RO-Crate 1.2's required rules, then confirms that missing required package metadata and
an unmerged fragment both fail validation. It also expands the JSON-LD with RDFLib and checks that
each role links to its CRediT term and Person.
