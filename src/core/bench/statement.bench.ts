import { describe, test } from "vitest";
import { FIXTURE_AUTHORS as AUTHORS, BY_AUTHOR, BY_ROLE } from "../__tests__/statement-fixtures";
import { MAX_STATEMENT_LENGTH, parseStatement, type StatementAuthor } from "../statement";

// 200 authors, and a statement of distinct initials-like tokens: each one scans every author.
const MANY: StatementAuthor[] = Array.from({ length: 200 }, (_, i) => ({
  given: `Given${i}`,
  surname: `Family${i}`,
}));
const MANY_INITIALS = Array.from(
  { length: 4000 },
  (_, i) =>
    `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + (Math.floor(i / 26) % 26))}${i % 7 ? "" : "Z"}`,
)
  .join(", ")
  .slice(0, MAX_STATEMENT_LENGTH);

describe("parseStatement at the length limit", () => {
  test("by author and by role", async ({ bench }) => {
    await bench.compare(
      bench("by author", () => {
        parseStatement(BY_AUTHOR, AUTHORS);
      }),
      bench("by role", () => {
        parseStatement(BY_ROLE, AUTHORS);
      }),
      bench("200 authors, many initials", () => {
        parseStatement(MANY_INITIALS, MANY);
      }),
    );
  });
});
