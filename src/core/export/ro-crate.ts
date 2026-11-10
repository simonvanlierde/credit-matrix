import type { Author } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { buildAttribution } from "./codemeta";

interface Reference {
  "@id": string;
}

export interface RoCrateAttributionFragment {
  "@context": "https://w3id.org/ro/crate/1.2/context";
  "@graph": (Reference & Record<string, unknown>)[];
}

/**
 * People, CRediT Role entities and links for an existing RO-Crate 1.2 root.
 * Merge the ./ entry into the crate's root and append the other graph entries,
 * reconciling existing identifiers. This fragment is not a standalone crate.
 * No package title, publication date, licence or workflow claims are invented.
 */
export function toRoCrateFragment(authors: Author[]): { metadata: RoCrateAttributionFragment; warnings: string[] } {
  const { metadata: attribution, warnings } = buildAttribution(authors);
  const root = { "@id": "./", author: [] as Reference[], contributor: [] as Reference[] };
  const graph: RoCrateAttributionFragment["@graph"] = [root];
  const people = new Set<string>();
  const terms = new Set<string>();
  let roleIndex = 0;
  for (const field of ["author", "contributor"] as const) {
    for (const entry of attribution[field]) {
      if (entry.type === "Person") {
        const { type, id, ...name } = entry;
        if (!people.has(id)) {
          graph.push({ "@id": id, "@type": type, ...name });
          people.add(id);
        }
        if (!root[field].some((reference) => reference["@id"] === id)) root[field].push({ "@id": id });
      } else {
        const id = `#credit-matrix-role-${++roleIndex}`;
        graph.push({
          "@id": id,
          "@type": "Role",
          [field]: { "@id": entry["schema:author"] },
          roleName: { "@id": entry.roleName },
        });
        terms.add(entry.roleName);
        root[field].push({ "@id": id });
      }
    }
  }
  for (const role of CREDIT_ROLES) {
    if (terms.has(role.url)) graph.push({ "@id": role.url, "@type": "DefinedTerm", name: role.name });
  }
  warnings.push("This attribution fragment is not a standalone RO-Crate; merge it into your package metadata.");
  if (roleIndex)
    warnings.push("RO-Crate attribution omits scores and contribution levels; keep the original roster JSON.");
  return { metadata: { "@context": "https://w3id.org/ro/crate/1.2/context", "@graph": graph }, warnings };
}
