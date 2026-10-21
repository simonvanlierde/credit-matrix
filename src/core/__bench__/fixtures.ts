import type { Author } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { createAuthor } from "../parse-authors";

const GIVEN = ["Ada", "Bob", "Carol", "José", "Mei", "Anne", "Kwame", "Ingrid", "Ravi", "Olga", "Ana María", "Pieter"];
const SURNAMES = [
  "Lovelace",
  "White",
  "Black",
  "García López",
  "Chen",
  "van der Berg",
  "Mensah",
  "Johansson",
  "Patel",
  "Ivanova",
  "O'Brien",
  "de Vries",
  "Müller-Schmidt",
];
const SCORES = [0, 0, 33, 66, 100, 0, 100];

/** Display names that are deterministic, varied, and unique enough to stress initials deduplication. */
export function names(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const given = GIVEN[i % GIVEN.length];
    const surname = SURNAMES[(i * 7 + 3) % SURNAMES.length];
    return `${given} ${surname}`;
  });
}

/** A roster of `count` contributors with a spread of levels, ORCIDs and markers, built without randomness. */
export function roster(count: number): Author[] {
  return names(count).map((name, i) =>
    createAuthor(name, {
      id: `author-${i}`,
      orcid: i % 3 === 0 ? "0000-0002-1825-0097" : undefined,
      contributorType: i % 9 === 8 ? "non-author" : "author",
      equalContribution: i < 2,
      corresponding: i === 0,
      contributions: CREDIT_ROLES.map((role, r) => ({
        role: role.name,
        score: SCORES[(i + r * 3) % SCORES.length] ?? 0,
      })),
    }),
  );
}
