import { MAX_STATEMENT_LENGTH, type StatementAuthor } from "../statement";

export const FIXTURE_AUTHORS: StatementAuthor[] = [
  { given: "Ann", surname: "Bell" },
  { given: "Chen", surname: "Dai" },
  { given: "Eva", surname: "Fox" },
  { given: "Li-Jun", surname: "Zhao" },
  { given: "Nils", surname: "Zandvoort" },
];

const atLimit = (unit: string) =>
  unit.repeat(Math.ceil(MAX_STATEMENT_LENGTH / unit.length)).slice(0, MAX_STATEMENT_LENGTH);

// The author-first and role-first layouts, at the longest statement the parser accepts. It once took
// quadratic time on input like this.
export const BY_AUTHOR = atLimit("Ann Bell, AB: conceptualization; CD, LJZ: writing - original draft; ");
export const BY_ROLE = atLimit("Conceptualization, A.B. and C.D.; Methodology, E.F. and L.-J.Z.; ");
