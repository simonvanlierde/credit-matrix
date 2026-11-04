import { describe, test } from "vitest";
import { MAX_STATEMENT_LENGTH, parseStatement, type StatementAuthor } from "../statement";

const AUTHORS: StatementAuthor[] = [
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
const BY_AUTHOR = atLimit("Ann Bell, AB: conceptualization; CD, LJZ: writing - original draft; ");
const BY_ROLE = atLimit("Conceptualization, A.B. and C.D.; Methodology, E.F. and L.-J.Z.; ");

describe("parseStatement at the length limit", () => {
  test("by author and by role", async ({ bench }) => {
    await bench.compare(
      bench("by author", () => {
        parseStatement(BY_AUTHOR, AUTHORS);
      }),
      bench("by role", () => {
        parseStatement(BY_ROLE, AUTHORS);
      }),
    );
  });
});
