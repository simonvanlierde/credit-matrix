import { describe, expect, it } from "vitest";
import { MAX_AUTHOR_NAME_LENGTH } from "../author";
import {
  createAuthor,
  deduplicateAuthorInitials,
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

  it("keeps particles with the surname, in any case, as the comma form does", () => {
    const parts = { firstName: "Anne", middleName: "", surname: "van der Berg" };
    expect(parseNameParts("Anne van der Berg")).toEqual(parts);
    expect(parseNameParts("van der Berg, Anne")).toEqual(parts);
    expect(parseNameParts("Maria Luisa de la Cruz")).toEqual({
      firstName: "Maria",
      middleName: "Luisa",
      surname: "de la Cruz",
    });
    expect(parseNameParts("Anne Van der Berg").surname).toBe("Van der Berg");
    expect(parseNameParts("Anne DE LA CRUZ").surname).toBe("DE LA CRUZ");
    expect(parseNameParts("Jacobus van’t Hoff").surname).toBe("van’t Hoff");
    expect(parseNameParts("João dos Santos").surname).toBe("dos Santos");
    expect(parseNameParts("Ahmad bin Ali").surname).toBe("bin Ali");
    // The first name is never a particle, and "y" joins two surnames rather than leading one.
    expect(parseNameParts("van Berg").firstName).toBe("van");
    expect(parseNameParts("José Ortega y Gasset").surname).toBe("Gasset");
  });

  it("treats a single-token name as a first name with empty surname", () => {
    expect(parseNameParts("Madonna")).toEqual({
      firstName: "Madonna",
      middleName: "",
      surname: "",
    });
  });
});

describe("parseNameParts particles", () => {
  it.each([
    "van",
    "von",
    "de",
    "del",
    "della",
    "di",
    "da",
    "du",
    "le",
    "la",
    "den",
    "der",
    "ten",
    "ter",
    "dos",
    "das",
    "do",
    "los",
    "las",
    "degli",
    "dei",
    "dalla",
    "dal",
    "zu",
    "zur",
    "af",
    "bin",
    "ibn",
    "el",
    "al",
    "van't",
  ])("keeps %s with the surname", (particle) => {
    expect(parseNameParts(`Anna ${particle} Berg`)).toEqual({
      firstName: "Anna",
      middleName: "",
      surname: `${particle} Berg`,
    });
  });

  it("never pulls the first name into the surname", () => {
    expect(parseNameParts("van Berg")).toEqual({ firstName: "van", middleName: "", surname: "Berg" });
  });
});

describe("createAuthor", () => {
  it("uses the name parts it is given over the ones it would parse", () => {
    expect(
      createAuthor("Anne Marie Curie", { firstName: "Annie", middleName: "", surname: "Marie Curie" }),
    ).toMatchObject({ firstName: "Annie", middleName: "", surname: "Marie Curie" });
  });

  it("takes a name of exactly the maximum length", () => {
    const name = `Jane ${"a".repeat(MAX_AUTHOR_NAME_LENGTH - 5)}`;
    expect(createAuthor(name).name).toHaveLength(MAX_AUTHOR_NAME_LENGTH);
    expect(() => createAuthor(`${name}a`)).toThrow(/characters or fewer/);
  });

  it("writes initials in upper case for a name typed in lower case", () => {
    expect(createAuthor("jane anne smith").initials).toBe("JAS");
  });

  it.each([
    ["さくら", "さくら"],
    ["サクラ", "サクラ"],
    ["김민준", "김민준"],
    ["王 小明", "王小"],
    ["A王", "A"],
  ])("labels %s as %s", (name, initials) => {
    expect(createAuthor(name).initials).toBe(initials);
  });

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
    expect(parseAuthorText("王小明\n王大明").map((a) => a.initials)).toEqual(["王小明", "王大明"]);
  });

  it("never builds initials from punctuation", () => {
    // A row still named by its ORCID (lookup failed) keeps the iD as its label.
    expect(createAuthor("0000-0002-1825-0097").initials).toBe("0000-0002-1825-0097");
    expect(createAuthor("0000-0002-1694-233X").initials).toBe("0000-0002-1694-233X");
    expect(createAuthor("https://orcid.org/0000-0002-1825-0097").initials).toBe("0000-0002-1825-0097");
    expect(createAuthor("Jane - Smith").initials).toBe("JS");
  });

  it("takes the surname initial from its first word that is not a particle", () => {
    expect(createAuthor("Anne van der Berg").initials).toBe("AB");
    expect(createAuthor("van der Berg, Anne").initials).toBe("AB");
    expect(createAuthor("Leonardo da Vinci").initials).toBe("LV");
    expect(createAuthor("Jean-Luc de la Fontaine").initials).toBe("JF");
    expect(
      createAuthor("Anne van der Berg", { firstName: "Anne", middleName: "", surname: "van der Berg" }).initials,
    ).toBe("AB");
    // Telling two apart continues from that word, not from the particle.
    expect(parseAuthorText("Anne Bakker\nAnne van der Berg").map((a) => a.initials)).toEqual(["AB", "ABe"]);
  });

  it("keeps one character per name part when upper case would add one", () => {
    // "ß".toUpperCase() is "SS".
    expect(createAuthor("ßtefan Weiß").initials).toBe("ßW");
  });

  it("stores names in one Unicode form", () => {
    const nfd = createAuthor("Zoë Müller", { firstName: "Zoë" });
    expect(nfd.name).toBe("Zoë Müller");
    expect(nfd.firstName).toBe("Zoë");
    expect(nfd.initials).toBe("ZM");
  });

  it("turns control characters in a name into a space", () => {
    const author = createAuthor("Ann\u0001Lee\t", { surname: "Lee\u0000" });
    expect(author.name).toBe("Ann Lee");
    expect(author.surname).toBe("Lee");
  });

  it("cleans a long run of spaces in linear time, then applies the length cap", () => {
    const started = performance.now();
    expect(() => createAuthor(`a${" ".repeat(1_000_000)}b`)).toThrow(/characters or fewer/);
    expect(performance.now() - started).toBeLessThan(500);
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
    const initials = parseAuthorText("Jo Li\nJo Li\nJo Li").map((a) => a.initials);
    expect(new Set(initials).size).toBe(3);
    expect(initials.slice(0, 2)).toEqual(["JL", "JLi"]);
  });

  it("counts on from 2 once the surname has no letters left", () => {
    expect(parseAuthorText("Jo Li\nJo Li\nJo Li\nJo Li").map((a) => a.initials)).toEqual(["JL", "JLi", "JL2", "JL3"]);
  });

  it("deduplicates supplementary-plane initials without corrupting Unicode", () => {
    const initials = parseAuthorText("A 𐐀x\nA 𐐀y").map((author) => author.initials);

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

  it("splits on Word's Shift+Enter, form feeds and bare carriage returns", () => {
    expect(splitNameList("Ann Lee\vBob Kim\fCay Dunn\rDee Fox\r\nEd Ng")).toEqual([
      "Ann Lee",
      "Bob Kim",
      "Cay Dunn",
      "Dee Fox",
      "Ed Ng",
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

  it("reads up to three given names as the second half of an inverted name, not four", () => {
    expect(splitNameList("Smith, Jane Ann Marie")).toEqual(["Smith, Jane Ann Marie"]);
    expect(splitNameList("Smith, Jane Ann Marie Lou")).toEqual(["Smith", "Jane Ann Marie Lou"]);
  });

  it("does not read a chunk that ends without a letter as a surname", () => {
    expect(splitNameList("Lab 42, Jane")).toEqual(["Lab 42", "Jane"]);
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
