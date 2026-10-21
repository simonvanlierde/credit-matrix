import fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as z from "zod/mini";
import { type Author, scoreToLevel } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { fromCsv, toCsv } from "../export/csv";
import { fromJson, NewerVersionError, toJson } from "../export/json";
import { toJats4rXml } from "../export/xml";
import { fromJats4rXml } from "../export/xml-import";
import { importAny } from "../import";
import { createAuthor, deduplicateAuthorInitials } from "../parse-authors";
import { fromSharePayload, toSharePayload } from "../share-payload";

// Names the formats must carry: accents, CJK, quotes, `&`, `<`, and line breaks mixed into a real word.
const nameArb = fc
  .tuple(
    fc.constantFrom("José", "Zoë", "O'Brien", "日本語", "Smith & Co", "Ana García", "Müller", "Ng"),
    fc.array(fc.constantFrom(" ", '"', "'", "&", "<", ">", "\r", "\n", ",", "é", "ß", "Ω", "李"), { maxLength: 6 }),
    fc.constantFrom("Lee", "Åkesson", "van der Berg", "Li"),
  )
  .map(([first, junk, last]) => `${first}${junk.join("")} ${last}`);

// A valid ORCID needs its MOD 11-2 check digit, so compute it instead of filtering random digits.
const orcidArb = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 15, maxLength: 15 }).map((digits) => {
  const total = digits.reduce((sum, digit) => (sum + digit) * 2, 0);
  const check = (12 - (total % 11)) % 11;
  return `${digits.join("")}${check === 10 ? "X" : check}`.replace(/(.{4})(?=.)/g, "$1-");
});

const authorArb = fc
  .record({
    name: nameArb,
    orcid: fc.option(orcidArb, { nil: undefined }),
    contributorType: fc.constantFrom("author" as const, "non-author" as const),
    scores: fc.array(fc.integer({ min: 0, max: 100 }), {
      minLength: CREDIT_ROLES.length,
      maxLength: CREDIT_ROLES.length,
    }),
    equalContribution: fc.boolean(),
    corresponding: fc.boolean(),
  })
  .map(({ scores, name, ...rest }) =>
    createAuthor(name, {
      ...rest,
      contributions: CREDIT_ROLES.map((role, i) => ({ role: role.name, score: scores[i] ?? 0 })),
    }),
  );

const draftArb = fc
  .array(authorArb, { minLength: 1, maxLength: 5 })
  .map((authors) => deduplicateAuthorInitials(authors.map((author, i) => ({ ...author, id: `id-${i}` }))));

/** Who is in the draft and what each is credited with, as exact scores or only their levels. */
function summary(authors: Author[], { exact, byInitials = false }: { exact: boolean; byInitials?: boolean }) {
  return authors.map((author) => ({
    name: byInitials ? author.initials : author.name,
    orcid: author.orcid,
    contributorType: author.contributorType,
    scores: CREDIT_ROLES.map((role) => {
      const score = author.contributions.find((c) => c.role === role.name)?.score ?? 0;
      return exact ? score : scoreToLevel(score);
    }),
  }));
}

describe("export round trips", () => {
  it("JSON keeps every contributor and exact score", () => {
    fc.assert(
      fc.property(draftArb, (authors) => {
        expect(summary(fromJson(toJson(authors)).authors, { exact: true })).toEqual(summary(authors, { exact: true }));
      }),
    );
  });

  it("CSV keeps every contributor and exact score", () => {
    fc.assert(
      fc.property(draftArb, (authors) => {
        expect(summary(fromCsv(toCsv(authors)), { exact: true })).toEqual(summary(authors, { exact: true }));
      }),
    );
  });

  it("the share payload keeps every contributor and exact score", () => {
    fc.assert(
      fc.property(draftArb, (authors) => {
        const shared = fromSharePayload(toSharePayload({ authors })).authors;
        expect(summary(shared, { exact: true })).toEqual(summary(authors, { exact: true }));
      }),
    );
  });

  it("JATS keeps every contributor and each score's level", () => {
    // `degree-contribution` stores the level, not the score, and the name travels as given names
    // and surname, which come back re-spaced and reordered ("Surname, First"): identify by initials.
    fc.assert(
      fc.property(draftArb, (authors) => {
        const parsed = fromJats4rXml(toJats4rXml(authors));
        expect(summary(parsed, { exact: false, byInitials: true })).toEqual(
          summary(authors, { exact: false, byInitials: true }),
        );
      }),
    );
  });
});

describe("untrusted input", () => {
  // What the docstrings name: NewerVersionError, ZodError, an XML parse error or a JSON SyntaxError, and plain Errors.
  const isDocumented = (error: unknown) =>
    error instanceof NewerVersionError ||
    (error instanceof Error &&
      (error instanceof z.core.$ZodError || error instanceof SyntaxError || error.constructor === Error));

  // Plain text, plus text that starts like each format so the XML, JSON, CSV and link readers run.
  const textArb = fc.oneof(
    fc.string({ unit: "binary" }),
    fc.string(),
    fc.string().map((rest) => `<${rest}`),
    fc.string().map((rest) => `{${rest}`),
    fc.string().map((rest) => `#s=${rest}`),
    fc.string().map((rest) => `Name,${rest}`),
  );

  it("importAny returns or throws a documented error on any string", async () => {
    await fc.assert(
      fc.asyncProperty(textArb, async (text) => {
        try {
          await importAny(text);
        } catch (error) {
          expect(isDocumented(error), String(error)).toBe(true);
        }
      }),
    );
  });

  it("fromSharePayload returns or throws a documented error on any JSON value", () => {
    fc.assert(
      fc.property(fc.json(), (json) => {
        try {
          fromSharePayload(json);
        } catch (error) {
          expect(isDocumented(error), String(error)).toBe(true);
        }
      }),
    );
  });

  it("fromSharePayload survives payload-shaped JSON with wrong field types", () => {
    const entry = fc.record(
      { i: fc.anything(), n: fc.anything(), o: fc.anything(), t: fc.anything(), s: fc.anything() },
      { requiredKeys: [] },
    );
    const payload = fc.record(
      { v: fc.constant(2), a: fc.array(entry, { maxLength: 3 }), t: fc.anything() },
      { requiredKeys: ["v"] },
    );
    fc.assert(
      fc.property(payload, (value) => {
        try {
          fromSharePayload(JSON.stringify(value));
        } catch (error) {
          expect(isDocumented(error), String(error)).toBe(true);
        }
      }),
    );
  });
});
