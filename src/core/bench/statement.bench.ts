import { describe, test } from "vitest";
import { FIXTURE_AUTHORS as AUTHORS, BY_AUTHOR, BY_ROLE } from "../__tests__/statement-fixtures";
import { parseStatement, type StatementAuthor } from "../statement";

// 200 authors, and a statement of distinct initials-like tokens: each one scans every author.
// Kept well under the length limit: CodSpeed's simulated CPU runs it about 50 times slower.
const MANY: StatementAuthor[] = Array.from({ length: 200 }, (_, i) => ({
  given: `Given${i}`,
  surname: `Family${i}`,
}));
const MANY_INITIALS = Array.from(
  { length: 1000 },
  (_, i) =>
    `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + (Math.floor(i / 26) % 26))}${i % 7 ? "" : "Z"}`,
).join(", ");

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

describe("parseStatement with many authors", () => {
  test("200 authors, many initials", { timeout: 300_000 }, async ({ bench }) => {
    await bench("200 authors, many initials", () => {
      parseStatement(MANY_INITIALS, MANY);
    }).run();
  });
});
