/**
 * The people in tests, docs and demos: dead scientists, each picked for the name case they cover.
 *
 * Use a name from here when a test needs "some contributors"; build the author with
 * `createAuthor(cast.ada, overrides)` so name parts and initials come from the real parser, and
 * keep the expected strings literal in the assertion. A parser test about one odd spelling
 * ("SMITH, J.", "Anne DE LA CRUZ") keeps its own name inline: the spelling is the point.
 *
 * `sampleNames` in each locale catalog is the in-app "Load sample data" cast and belongs to the
 * translators; sample-names.test.ts pins the English trio below to the catalog.
 */
export const cast = {
  // The English sample trio, in catalog order.
  ada: "Ada Lovelace", // two plain ASCII parts: "AL"
  rosalind: "Rosalind E. Franklin", // middle initial: "REF"
  alan: "Alan M. Turing", // middle initial: "AMT"

  // A generic pair for setup that is not about names.
  grace: "Grace Hopper", // "GH"; "Grace B. Hopper" when a test needs a middle initial
  charles: "Charles Darwin", // "CD"; "Charles R. Darwin" likewise

  // Name cases.
  marie: "Marie Skłodowska-Curie", // non-ASCII, hyphenated surname: "MS"
  antonie: "Antonie van Leeuwenhoek", // particle, skipped in initials: "AL", the same as Ada's
  tu: "Tu Youyou", // family name first; the parser reads "Tu" as the given name: "TY"
} as const;

/** Names the cast replaced. cast.test.ts fails when one comes back. */
export const RETIRED_PLACEHOLDERS = ["Jane Smith", "Jane A. Smith", "Bob White"] as const;
