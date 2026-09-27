import { describe, expect, it } from "vitest";
import {
  AuthorSchema,
  activeContributions,
  ContributionSchema,
  hasContributions,
  isValidOrcid,
  ORCID_INPUT_REGEX,
  ORCID_REGEX,
  scoreToLevel,
} from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { createAuthor, parseAuthorText } from "../parse-authors";

/** Minimal schema-valid author, for tests that vary one field. */
const VALID_AUTHOR = {
  name: "Jane Smith",
  firstName: "Jane",
  middleName: "",
  surname: "Smith",
  initials: "JS",
  contributions: [],
};

describe("isValidOrcid", () => {
  it("accepts iDs with a correct MOD 11-2 check digit (bare and URL form)", () => {
    expect(isValidOrcid("0000-0002-1825-0097")).toBe(true); // Josiah Carberry
    expect(isValidOrcid("https://orcid.org/0000-0002-1825-0097")).toBe(true);
    expect(isValidOrcid("0000-0000-0000-0001")).toBe(true);
  });

  it("rejects a well-formed iD with a wrong check digit", () => {
    // Correct check digit for 0000-0002-1825-009 is 7, not 6.
    expect(isValidOrcid("0000-0002-1825-0096")).toBe(false);
    // The regex example digits check to 9, so the "X" variant is invalid.
    expect(isValidOrcid("0000-0001-2345-678X")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isValidOrcid("not-an-orcid")).toBe(false);
    expect(isValidOrcid("0000-0002-1825-009")).toBe(false);
  });
});

describe("scoreToLevel", () => {
  it("maps scores to levels at the tier boundaries", () => {
    expect(scoreToLevel(0)).toBe("none");
    expect(scoreToLevel(1)).toBe("supporting");
    expect(scoreToLevel(33)).toBe("supporting");
    expect(scoreToLevel(34)).toBe("equal");
    expect(scoreToLevel(66)).toBe("equal");
    expect(scoreToLevel(67)).toBe("lead");
    expect(scoreToLevel(100)).toBe("lead");
  });
});

describe("hasContributions / activeContributions", () => {
  it("reports false and an empty list when all scores are zero", () => {
    const [author] = parseAuthorText("Alice Brown");
    if (!author) throw new Error("expected author");
    expect(hasContributions(author)).toBe(false);
    expect(activeContributions(author)).toEqual([]);
  });

  it("returns only the non-zero contributions", () => {
    const [author] = parseAuthorText("Alice Brown");
    if (!author) throw new Error("expected author");
    const first = author.contributions[0];
    const third = author.contributions[2];
    if (!(first && third)) throw new Error("expected contributions");
    first.score = 100;
    third.score = 40;

    expect(hasContributions(author)).toBe(true);
    const active = activeContributions(author);
    expect(active).toHaveLength(2);
    expect(active.map((c) => c.score)).toEqual([100, 40]);
  });
});

describe("ORCID_REGEX", () => {
  it("accepts well-formed iDs, including a trailing X checksum", () => {
    expect(ORCID_REGEX.test("0000-0002-1825-0097")).toBe(true);
    expect(ORCID_REGEX.test("0000-0001-2345-678X")).toBe(true);
  });

  it("rejects malformed iDs", () => {
    expect(ORCID_REGEX.test("1234")).toBe(false);
    expect(ORCID_REGEX.test("0000-0002-1825-009")).toBe(false); // too short
    expect(ORCID_REGEX.test("0000-0001-2345-678x")).toBe(false); // lowercase x
    expect(ORCID_REGEX.test("https://orcid.org/0000-0002-1825-0097")).toBe(false); // URL form
  });
});

describe("ORCID_INPUT_REGEX", () => {
  it("accepts both bare and orcid.org URL forms", () => {
    expect(ORCID_INPUT_REGEX.test("0000-0002-1825-0097")).toBe(true);
    expect(ORCID_INPUT_REGEX.test("https://orcid.org/0000-0002-1825-0097")).toBe(true);
    expect(ORCID_INPUT_REGEX.test("0000-0001-2345-678X")).toBe(true);
  });

  it("rejects malformed iDs", () => {
    expect(ORCID_INPUT_REGEX.test("not-an-orcid")).toBe(false);
    expect(ORCID_INPUT_REGEX.test("0000-0002-1825-009")).toBe(false);
  });
});

describe("schemas", () => {
  it("defaults a random id and accepts a minimal valid author", () => {
    const author = AuthorSchema.parse({
      name: "Jane Smith",
      firstName: "Jane",
      middleName: "",
      surname: "Smith",
      initials: "JS",
      contributions: [],
    });
    expect(author.id).toMatch(/[0-9a-f-]{36}/);
  });

  it("rejects an empty name", () => {
    expect(() =>
      AuthorSchema.parse({
        name: "",
        firstName: "",
        middleName: "",
        surname: "",
        initials: "",
        contributions: [],
      }),
    ).toThrow();
  });

  it("rejects out-of-range or non-integer scores", () => {
    expect(() => ContributionSchema.parse({ role: "Software", score: 101 })).toThrow();
    expect(() => ContributionSchema.parse({ role: "Software", score: -1 })).toThrow();
    expect(() => ContributionSchema.parse({ role: "Software", score: 12.5 })).toThrow();
  });

  it("rejects an unknown role name", () => {
    expect(() => ContributionSchema.parse({ role: "Not A Role", score: 50 })).toThrow();
  });

  it("rejects a malformed ORCID but accepts a valid one", () => {
    const base = {
      name: "Jane Smith",
      firstName: "Jane",
      middleName: "",
      surname: "Smith",
      initials: "JS",
      contributions: [],
    };
    expect(() => AuthorSchema.parse({ ...base, orcid: "bogus" })).toThrow();
    expect(AuthorSchema.parse({ ...base, orcid: "0000-0002-1825-0097" }).orcid).toBe("0000-0002-1825-0097");
  });

  // Regression: the schema accepted any non-empty name, so an imported "123"
  // parsed cleanly here and then threw inside createAuthor on the next store
  // mutation, reaching the user as a crash rather than an import error.
  it.each(["123", "  ", "-- --", "42.0"])("rejects %o, which createAuthor cannot build", (name) => {
    expect(() => AuthorSchema.parse({ ...VALID_AUTHOR, name })).toThrow();
    expect(() => createAuthor(name)).toThrow();
  });

  // Adding a contributor by iD seeds the row named after the iD, so this
  // placeholder has to pass validation, persistence and export.
  it.each(["0000-0002-1825-0097", "https://orcid.org/0000-0002-1825-0097"])(
    "accepts the ORCID placeholder name %o",
    (name) => {
      expect(AuthorSchema.parse({ ...VALID_AUTHOR, name }).name).toBe(name);
      expect(() => createAuthor(name)).not.toThrow();
    },
  );

  it.each(["Jane Smith", "李雷", "O'Brien", "Ana-María"])("accepts the real name %o", (name) => {
    expect(AuthorSchema.parse({ ...VALID_AUTHOR, name }).name).toBe(name);
    expect(() => createAuthor(name)).not.toThrow();
  });

  it("accepts a contributions array that repeats a role, so the merge can run", () => {
    // normalizeContributions keeps the highest score for a repeated role; the
    // old length cap rejected that payload before the merge could run.
    const contributions = [
      { role: "Software" as const, score: 40 },
      { role: "Software" as const, score: 90 },
      ...CREDIT_ROLES.map((role) => ({ role: role.name, score: 0 })),
    ];
    expect(() => AuthorSchema.parse({ ...VALID_AUTHOR, contributions })).not.toThrow();
    expect(createAuthor("Jane Smith", { contributions }).contributions).toContainEqual({
      role: "Software",
      score: 90,
    });
  });
});
