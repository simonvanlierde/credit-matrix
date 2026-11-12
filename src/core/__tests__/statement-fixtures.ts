import { createAuthor } from "../parse-authors";
import { MAX_STATEMENT_LENGTH, type StatementAuthor, statementAuthor } from "../statement";

export const FIXTURE_AUTHORS: StatementAuthor[] = [
  statementAuthor(createAuthor("Ada Lovelace")),
  { given: "Chen", surname: "Dai" },
  { given: "Eva", surname: "Fox" },
  { given: "Li-Jun", surname: "Zhao" },
  { given: "Nils", surname: "Zandvoort" },
];

const atLimit = (unit: string) =>
  unit.repeat(Math.ceil(MAX_STATEMENT_LENGTH / unit.length)).slice(0, MAX_STATEMENT_LENGTH);

// The author-first and role-first layouts, at the longest statement the parser accepts. It once took
// quadratic time on input like this.
export const BY_AUTHOR = atLimit("Ada Lovelace, AL: conceptualization; CD, LJZ: writing - original draft; ");
export const BY_ROLE = atLimit("Conceptualization, A.L. and C.D.; Methodology, E.F. and L.-J.Z.; ");
