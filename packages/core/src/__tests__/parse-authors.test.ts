import { describe, expect, it } from "vitest";
import {
  createAuthor,
  deduplicateAuthorInitials,
  parseAuthors,
  parseAuthorText,
  parseNameParts,
  splitNameList,
} from "../parse-authors";

describe("parseNameParts", () => {
  it("parses a three-part name", () => {
    expect(parseNameParts("Jane A Smith")).toEqual({
      firstName: "Jane",
      middleName: "A",
      surname: "Smith",
    });
  });

  it("parses a two-part name (no middle)", () => {
    expect(parseNameParts("Bob White")).toEqual({
      firstName: "Bob",
      middleName: "",
      surname: "White",
    });
  });

  it("keeps Unicode letters, apostrophes and hyphens; drops other punctuation", () => {
    // spell-checker: ignore Séan García
    expect(parseNameParts("José García")).toEqual({
      firstName: "José",
      middleName: "",
      surname: "García",
    });
    expect(parseNameParts("Mary-Jane Watson")).toEqual({
      firstName: "Mary-Jane",
      middleName: "",
      surname: "Watson",
    });
    // Surname-first notation is normalized, and the apostrophe survives.
    expect(parseNameParts("O'Brien, Séan")).toEqual({ firstName: "Séan", middleName: "", surname: "O'Brien" });
  });

  it("parses surname-first notation into canonical name fields", () => {
    expect(parseNameParts("Curie, Marie")).toEqual({
      firstName: "Marie",
      middleName: "",
      surname: "Curie",
    });
    expect(parseNameParts("van der Berg, Anne")).toEqual({
      firstName: "Anne",
      middleName: "",
      surname: "van der Berg",
    });
  });

  it("treats a single-token name as a first name with empty surname", () => {
    expect(parseNameParts("Madonna")).toEqual({
      firstName: "Madonna",
      middleName: "",
      surname: "",
    });
  });
});

describe("createAuthor", () => {
  it("throws when the name contains no letters", () => {
    expect(() => createAuthor("123")).toThrow(/at least one letter/);
    expect(() => createAuthor("!!!")).toThrow(/at least one letter/);
  });

  it("rejects a malformed ORCID but accepts bare and URL forms", () => {
    expect(() => createAuthor("Jane Smith", { orcid: "not-an-orcid" })).toThrow(/ORCID/);
    expect(createAuthor("Jane Smith", { orcid: "0000-0002-1825-0097" }).orcid).toBe("0000-0002-1825-0097");
    expect(createAuthor("Jane Smith", { orcid: "https://orcid.org/0000-0002-1825-0097" }).orcid).toBe(
      "0000-0002-1825-0097",
    );
  });

  it("labels an unspaced CJK name by the whole name", () => {
    // Han, kana and Hangul names are written without spaces, so the first
    // character is the family name alone, not an initial.
    expect(createAuthor("王小明").initials).toBe("王小明");
    expect(createAuthor("ヤマダタロー").initials).toBe("ヤマダタロー");
    expect(createAuthor("김민준").initials).toBe("김민준");
    expect(parseAuthors(["王小明", "王大明"]).map((a) => a.initials)).toEqual(["王小明", "王大明"]);
  });
});

describe("deduplicateAuthorInitials", () => {
  it("does not mutate the input authors", () => {
    const original = [createAuthor("Alice Brown"), createAuthor("Amy Burke")];
    const beforeInitials = original.map((a) => a.initials);

    const deduped = deduplicateAuthorInitials(original);

    expect(original.map((a) => a.initials)).toEqual(beforeInitials);
    expect(deduped[0]).not.toBe(original[0]);
    expect(deduped[1]?.initials).not.toBe(deduped[0]?.initials);
  });

  it("still assigns unique initials when the surname runs out of letters", () => {
    // "Jo Li" → JL, then JLi (the surname's 2nd letter), and then the surname is
    // spent, so the disambiguator falls back to a counter suffix.
    const initials = parseAuthors(["Jo Li", "Jo Li", "Jo Li"]).map((a) => a.initials);
    expect(new Set(initials).size).toBe(3);
    expect(initials.slice(0, 2)).toEqual(["JL", "JLi"]);
  });

  it("deduplicates supplementary-plane initials without corrupting Unicode", () => {
    const initials = parseAuthors(["A 𐐀x", "A 𐐀y"]).map((author) => author.initials);

    expect(initials).toEqual(["A𐐀", "A𐐀y"]);
    expect(initials.every((value) => value.isWellFormed())).toBe(true);
  });

  it("terminates when the counter suffix collides with an existing label", () => {
    // Raw name-part overrides (as XML import passes) can yield a digit initial
    // ("J" + "2nd" → "J2"), which the counter fallback then has to step past.
    const authors = [createAuthor("J 2nd", { firstName: "J", surname: "2nd" }), createAuthor("J"), createAuthor("J")];
    expect(authors[0]?.initials).toBe("J2");

    const initials = deduplicateAuthorInitials(authors).map((a) => a.initials);
    expect(new Set(initials).size).toBe(3);
  });
});

describe("parseAuthorText", () => {
  it("parses newline-separated names", () => {
    const authors = parseAuthorText("Alice Brown\nBob White\nCarol Ann Davis");
    expect(authors).toHaveLength(3);
    expect(authors[0]?.initials).toBe("AB");
    expect(authors[1]?.initials).toBe("BW");
    expect(authors[2]?.initials).toBe("CAD");
  });

  it("keeps a surname-first name as one contributor", () => {
    const authors = parseAuthorText("Curie, Marie");

    expect(authors).toHaveLength(1);
    expect(authors[0]).toMatchObject({ name: "Curie, Marie", firstName: "Marie", surname: "Curie", initials: "MC" });
  });

  it("deduplicates initials when authors share them", () => {
    const authors = parseAuthorText("Alice Brown\nAmy Burke");
    expect(authors[0]?.initials).toBe("AB");
    // Second author "Amy Burke" also starts as AB, so it should be disambiguated
    expect(authors[1]?.initials).not.toBe("AB");
  });

  it("assigns 14 default zero-score contributions to each author", () => {
    const authors = parseAuthorText("Alice Brown");
    expect(authors[0]?.contributions).toHaveLength(14);
    expect(authors[0]?.contributions.every((c) => c.score === 0)).toBe(true);
  });
});

describe("splitNameList", () => {
  it("splits on newlines, semicolons, and commas", () => {
    expect(splitNameList("Alice Brown, Bob White; Carol Davis\nDan Evans")).toEqual([
      "Alice Brown",
      "Bob White",
      "Carol Davis",
      "Dan Evans",
    ]);
  });

  it("keeps a 'Lastname, Firstname' pair as one contributor", () => {
    expect(splitNameList("Curie, Marie")).toEqual(["Curie, Marie"]);
    expect(splitNameList("Curie, M.")).toEqual(["Curie, M."]);
    expect(splitNameList("Curie, Marie; Smith, Jane")).toEqual(["Curie, Marie", "Smith, Jane"]);
  });

  it("keeps multi-token given names and initials attached to their surname", () => {
    expect(splitNameList("Smith, J. A.")).toEqual(["Smith, J. A."]);
    expect(splitNameList("Curie, Marie Skłodowska")).toEqual(["Curie, Marie Skłodowska"]);
    expect(splitNameList("van der Berg, Anne")).toEqual(["van der Berg, Anne"]);
  });

  it("reads a comma-only list of inverted names as pairs", () => {
    expect(splitNameList("Curie, Marie, Smith, J. A.")).toEqual(["Curie, Marie", "Smith, J. A."]);
  });

  it("treats commas as separators when the chunks don't pair up as surname + given name", () => {
    expect(splitNameList("Alice Brown, Bob White")).toEqual(["Alice Brown", "Bob White"]);
    expect(splitNameList("Marie Curie, Jane Smith, Cher, Madonna")).toEqual([
      "Marie Curie",
      "Jane Smith",
      "Cher",
      "Madonna",
    ]);
  });

  it("splits a list containing a mononym", () => {
    expect(splitNameList("Marie Curie, Jane Smith, Cher")).toEqual(["Marie Curie", "Jane Smith", "Cher"]);
  });

  it("splits a name paired with an ORCID iD rather than reading it as an inverted name", () => {
    expect(splitNameList("Jane Smith, 0000-0002-1825-0097")).toEqual(["Jane Smith", "0000-0002-1825-0097"]);
  });

  it("ignores empty entries and surrounding whitespace", () => {
    expect(splitNameList("  Alice Brown ,, \n\n ; Bob White ")).toEqual(["Alice Brown", "Bob White"]);
  });
});
